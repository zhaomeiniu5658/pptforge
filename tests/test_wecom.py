"""OAuth tests with an isolated database and mocked WeCom responses."""
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from quark import wecom
from quark.db import Department, User, Audit, LoginSession, WecomIdentity, WecomLoginState, now
from quark.security import current_user, db_session


@pytest.fixture
def setup(monkeypatch):
    monkeypatch.setenv("PUBLIC_SYSTEM_LOGIN", "false")
    for key, value in dict(ENABLED="true", CORP_ID="ww-test", AGENT_ID="10001",
                           SECRET="private-test-secret", CALLBACK_URL="https://ppt.example/api/auth/wecom/callback").items():
        monkeypatch.setenv("WECOM_" + key, value)
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (Department, User, Audit, LoginSession, WecomIdentity, WecomLoginState):
        model.__table__.create(engine)
    Session = sessionmaker(engine, expire_on_commit=False)
    with Session() as db:
        user = User(username="staff", name="测试成员", password_hash="unused", role="business")
        db.add(user)
        db.flush()
        db.add(WecomIdentity(corp_id="ww-test", wecom_userid="member-1", user_id=user.id))
        db.commit()
    app = FastAPI()
    app.include_router(wecom.router)
    def session():
        with Session() as db:
            yield db
    app.dependency_overrides[db_session] = session
    monkeypatch.setattr(wecom, "access_token", lambda settings: "test-token")
    calls = []
    def provider(path, params):
        calls.append((path, params))
        return {"errcode": 0, "userid": "member-1"}
    monkeypatch.setattr(wecom, "provider_get", provider)
    with TestClient(app, base_url="https://ppt.example", headers={"user-agent":"Mozilla/5.0 wxwork/4.1.0"}, follow_redirects=False) as client:
        yield client, Session, app, calls
    engine.dispose()


def test_public_password_login_mode(setup, monkeypatch):
    client, Session, app, calls = setup
    from quark.main import login
    from quark.security import hash_password
    monkeypatch.setenv("PUBLIC_SYSTEM_LOGIN", "true")
    monkeypatch.setenv("LOCAL_SYSTEM_LOGIN", "true")
    monkeypatch.setenv("WECOM_ENABLED", "false")
    monkeypatch.setenv("WEB_ORIGIN", "https://ppt.example")
    app.post("/api/auth/login")(login)
    @app.get("/protected")
    def protected(user=__import__("fastapi").Depends(current_user)):
        return {"username": user.username}
    with Session() as db:
        db.scalar(select(User)).password_hash = hash_password("test-password")
        db.commit()
    client.headers["user-agent"] = "Chrome"
    assert client.get("/api/auth/wecom/config").json() == {"enabled": False, "required": False, "local_login": True}
    assert client.get("/protected").status_code == 401
    assert client.post("/api/auth/login", json={"username":"staff", "password":"wrong"}).status_code == 401
    assert client.post("/api/auth/login", json={"username":"staff", "password":"test-password"}).status_code == 200
    assert client.get("/protected").status_code == 200
    monkeypatch.setenv("PUBLIC_SYSTEM_LOGIN", "false")
    assert client.get("/protected").status_code == 403


def begin(client, next="/"):
    response = client.get("/api/auth/wecom/start", params={"next": next})
    assert response.status_code == 302
    query = parse_qs(urlsplit(response.headers["location"]).query)
    assert query["scope"] == ["snsapi_base"]
    assert query["appid"] == ["ww-test"]
    assert "private-test-secret" not in str(response.headers)
    return query["state"][0]


def test_login_preserves_identity_role_and_rejects_replay(setup):
    client, Session, app, calls = setup
    state = begin(client, "/projects")
    response = client.get("/api/auth/wecom/callback", params={"state": state, "code": "one-use-code"})
    assert response.status_code == 303 and response.headers["location"] == "/projects"
    assert "HttpOnly" in response.headers["set-cookie"] and "Secure" in response.headers["set-cookie"]
    with Session() as db:
        assert db.scalar(select(User)).role == "business"
        session = db.scalar(select(LoginSession))
        assert session is not None and session.auth_provider == "wecom" and session.auth_corp_id == "ww-test"
    response = client.get("/api/auth/wecom/callback", params={"state": state, "code": "one-use-code"})
    assert "wecom_error" in response.headers["location"]
    assert len(calls) == 1


@pytest.mark.parametrize("mode", ["wrong-state", "missing-cookie", "expired", "other-browser"])
def test_invalid_state_never_calls_provider(setup, mode):
    client, Session, app, calls = setup
    state = begin(client)
    if mode == "wrong-state":
        state = "wrong"
    elif mode == "missing-cookie":
        client.cookies.clear()
    elif mode == "other-browser":
        client.cookies.clear()
        client.cookies.set(wecom.STATE_COOKIE, "another-browser", domain="ppt.example", path="/api/auth/wecom")
    else:
        with Session() as db:
            db.scalar(select(WecomLoginState)).expires_at = now() - timedelta(seconds=1)
            db.commit()
    response = client.get("/api/auth/wecom/callback", params={"state": state, "code": "test"})
    assert "wecom_error" in response.headers["location"]
    assert calls == []


@pytest.mark.parametrize("mode", ["inactive", "unbound", "external"])
def test_membership_and_local_access_required(setup, monkeypatch, mode):
    client, Session, app, calls = setup
    with Session() as db:
        if mode == "inactive":
            db.scalar(select(User)).active = False
        elif mode == "unbound":
            db.delete(db.scalar(select(WecomIdentity)))
        db.commit()
    if mode == "external":
        monkeypatch.setattr(wecom, "provider_get", lambda *args: {"openid": "external"})
    state = begin(client)
    response = client.get("/api/auth/wecom/callback", params={"state": state, "code": "test"})
    assert "wecom_error" in response.headers["location"]
    with Session() as db:
        assert db.scalar(select(LoginSession)) is None


@pytest.mark.parametrize("path", ["https://evil.example", "//evil.example", "/\\evil.example", "/%2fevil.example", "/api/auth/logout"])
def test_redirects_stay_in_application(path):
    assert wecom.safe_next(path) == "/"


def test_only_admin_can_bind(setup):
    client, Session, app, calls = setup
    with Session() as db:
        user = db.scalar(select(User))
    app.dependency_overrides[current_user] = lambda: user
    body = [{"username": "staff", "wecom_userid": "new-id"}]
    assert client.put("/api/auth/wecom/bindings", json=body).status_code == 403
    user.role = "admin"
    assert client.put("/api/auth/wecom/bindings", json=body).status_code == 200
    with Session() as db:
        assert db.scalar(select(WecomIdentity)).wecom_userid == "new-id"


def test_disabled_config_and_secrets_not_public(setup, monkeypatch):
    client, Session, app, calls = setup
    assert client.get("/api/auth/wecom/config").json() == {"enabled": True, "required": True, "local_login": False}
    monkeypatch.setenv("WECOM_ENABLED", "false")
    assert client.get("/api/auth/wecom/config").json() == {"enabled": False, "required": True, "local_login": False}
    assert client.get("/api/auth/wecom/start").status_code == 503


def test_access_log_omits_oauth_credentials():
    import logging
    record = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                               ("client", "GET", "/api/auth/wecom/callback?code=private&state=secret", "1.1", 303), None)
    assert wecom.OAuthAccessLogFilter().filter(record)
    assert "private" not in record.getMessage() and "secret" not in record.getMessage()


def test_provider_failure_does_not_expose_secret(monkeypatch):
    import httpx
    def fail(*args, **kwargs):
        raise httpx.ConnectError("https://provider.example?corpsecret=private")
    monkeypatch.setattr(wecom.httpx, "get", fail)
    with pytest.raises(wecom.HTTPException) as exc:
        wecom.provider_get("gettoken", {"corpsecret": "private"})
    assert exc.value.status_code == 502 and "private" not in exc.value.detail


def test_start_requires_enterprise_client_and_ua_cannot_authenticate(setup):
    client, Session, app, calls = setup
    assert client.get("/api/auth/wecom/start", headers={"user-agent":"Chrome"}).status_code == 403
    from fastapi import Depends
    @app.get("/protected")
    def protected(user=Depends(current_user)):
        return {"username": user.username}
    assert client.get("/protected").status_code == 401
    assert calls == []


@pytest.mark.parametrize("mode", ["local", "wrong-corp", "expired", "unbound", "inactive", "valid"])
def test_only_valid_wecom_sessions_can_access(setup, mode):
    client, Session, app, calls = setup
    from fastapi import Depends
    from quark.security import token_hash
    @app.get("/protected")
    def protected(user=Depends(current_user)):
        return {"username": user.username}
    token = "only-test-token"
    with Session() as db:
        user = db.scalar(select(User))
        db.add(LoginSession(user_id=user.id, token_hash=token_hash(token),
                            expires_at=now() + timedelta(hours=-1 if mode == "expired" else 1),
                            auth_provider="local" if mode == "local" else "wecom",
                            auth_corp_id="wrong-corp" if mode == "wrong-corp" else "ww-test"))
        if mode == "unbound":
            db.delete(db.scalar(select(WecomIdentity)))
        if mode == "inactive":
            user.active = False
        db.commit()
    client.cookies.set("quark_session", token)
    assert client.get("/protected").status_code == (200 if mode == "valid" else 401)
    assert client.get("/protected", headers={"user-agent":"Chrome"}).status_code == 403


def test_password_login_is_disabled_without_consulting_database(monkeypatch):
    from quark.main import login, LoginIn
    from fastapi import Response
    with pytest.raises(wecom.HTTPException) as exc:
        login(LoginIn(username="admin", password="unused"), Response(), db=None)
    assert exc.value.status_code == 403


@pytest.mark.parametrize("environment,peer,host,origin,allowed", [
    ("production", "127.0.0.1", "localhost:5174", "http://localhost:5174", False),
    ("local", "127.0.0.1", "localhost:5174", "http://localhost:5174", True),
    ("local", "192.168.1.2", "localhost:5174", "http://localhost:5174", False),
    ("local", "127.0.0.1", "public.example", "https://public.example", False),
    ("local", "127.0.0.1", "localhost:5174", "https://other.example", False),
])
def test_local_login_gate(monkeypatch, environment, peer, host, origin, allowed):
    from starlette.requests import Request
    from quark.security import local_login_allowed
    monkeypatch.setenv("APP_ENV", environment)
    monkeypatch.setenv("LOCAL_SYSTEM_LOGIN", "true")
    request = Request({"type":"http", "method":"POST", "scheme":"http", "path":"/api/auth/login",
                       "headers":[(b"host",host.encode()),(b"origin",origin.encode())],
                       "client":(peer,12345), "server":("localhost",8011), "query_string":b""})
    assert local_login_allowed(request) is allowed
