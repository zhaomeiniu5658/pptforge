"""Self-built WeCom application OAuth; local roles remain authoritative."""
import os
import logging
import secrets
import threading
import time
from datetime import timedelta
from urllib.parse import urlencode, urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select

from .content import audit
from .db import LoginSession, User, WecomIdentity, WecomLoginState, now
from .security import admin, current_user, db_session, token_hash, require_wecom_client, local_login_allowed

router = APIRouter(prefix="/api/auth/wecom", tags=["WeCom"])
STATE_COOKIE = "quark_wecom_state"
_token_cache = {}
_token_lock = threading.Lock()


class OAuthAccessLogFilter(logging.Filter):
    def filter(self, record):
        if isinstance(record.args, tuple) and len(record.args) == 5:
            args = list(record.args)
            if isinstance(args[2], str) and args[2].startswith("/api/auth/wecom/callback?"):
                args[2] = "/api/auth/wecom/callback"
                record.args = tuple(args)
        return True


logging.getLogger("uvicorn.access").addFilter(OAuthAccessLogFilter())


def config():
    if os.getenv("WECOM_ENABLED", "false").lower() != "true":
        raise HTTPException(503, "企业微信登录尚未启用")
    values = {key: os.getenv("WECOM_" + key, "").strip()
              for key in ("CORP_ID", "AGENT_ID", "SECRET", "CALLBACK_URL")}
    callback = urlsplit(values["CALLBACK_URL"])
    if (not all(values.values()) or not values["AGENT_ID"].isdigit()
            or callback.scheme != "https" or not callback.hostname
            or callback.username or callback.password or callback.query or callback.fragment
            or callback.path != "/api/auth/wecom/callback"):
        raise HTTPException(503, "企业微信登录配置不完整或回调地址无效")
    return values


def safe_next(value):
    # Keep redirects relative and reject browser normalization of backslashes/control bytes.
    if (not value.startswith("/") or value.startswith("//")
            or "\\" in value or "%" in value or any(ord(c) < 32 for c in value)
            or len(value) > 2000 or value.startswith("/api/")):
        return "/"
    return value


def provider_get(path, params):
    try:
        response = httpx.get("https://qyapi.weixin.qq.com/cgi-bin/" + path,
                             params=params, timeout=10, follow_redirects=False)
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            raise ValueError()
    except (httpx.HTTPError, ValueError):
        # HTTP exceptions can contain request URLs with secrets; never echo them.
        raise HTTPException(502, "企业微信认证服务暂时不可用，请稍后重试") from None
    if data.get("errcode", 0) != 0:
        raise HTTPException(502, "企业微信认证失败，请管理员检查应用配置和可信 IP")
    return data


def access_token(settings):
    key = (settings["CORP_ID"], token_hash(settings["SECRET"]))
    with _token_lock:
        cached = _token_cache.get(key)
        if cached and cached[1] > time.monotonic():
            return cached[0]
        data = provider_get("gettoken", {"corpid": settings["CORP_ID"],
                                         "corpsecret": settings["SECRET"]})
        token = data.get("access_token")
        if not token:
            raise HTTPException(502, "企业微信未返回有效访问凭证")
        _token_cache[key] = (token, time.monotonic() + max(0, int(data.get("expires_in", 7200)) - 120))
        return token


@router.get("/config")
def public_config(request: Request):
    local_allowed = local_login_allowed(request)
    try:
        config()
        return {"enabled": True, "required": not local_allowed, "local_login": local_allowed}
    except HTTPException:
        return {"enabled": False, "required": not local_allowed, "local_login": local_allowed}


@router.get("/start")
def start(request: Request, next: str = "/", db=Depends(db_session)):
    require_wecom_client(request)
    settings = config()
    state, browser = secrets.token_hex(32), secrets.token_hex(32)
    db.execute(delete(WecomLoginState).where(WecomLoginState.expires_at <= now()))
    db.add(WecomLoginState(state_hash=token_hash(state), browser_hash=token_hash(browser),
                          next_path=safe_next(next), expires_at=now() + timedelta(minutes=5)))
    db.commit()
    params = dict(appid=settings["CORP_ID"], agentid=settings["AGENT_ID"],
                  redirect_uri=settings["CALLBACK_URL"], response_type="code",
                  scope="snsapi_base", state=state)
    response = RedirectResponse("https://open.weixin.qq.com/connect/oauth2/authorize?"
                                + urlencode(params) + "#wechat_redirect", status_code=302)
    response.set_cookie(STATE_COOKIE, browser, httponly=True, secure=True,
                        samesite="lax", max_age=300, path="/api/auth/wecom")
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@router.get("/callback")
def callback(request: Request, code: str = "", state: str = "", db=Depends(db_session)):
    try:
        return complete_callback(request, code, state, db)
    except HTTPException as exc:
        response = RedirectResponse("/?" + urlencode({"wecom_error": exc.detail}), status_code=303)
        response.delete_cookie(STATE_COOKIE, path="/api/auth/wecom", secure=True, httponly=True, samesite="lax")
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response


def complete_callback(request, code, state, db):
    require_wecom_client(request)
    settings = config()
    browser = request.cookies.get(STATE_COOKIE, "")
    if not browser or not state or len(state) > 128 or not code or len(code) > 512:
        raise HTTPException(400, "企业微信登录凭证缺失，请重新从工作台进入")
    # Atomic consume across API replicas; prevents replay and login CSRF.
    next_path = db.execute(delete(WecomLoginState).where(
        WecomLoginState.state_hash == token_hash(state),
        WecomLoginState.browser_hash == token_hash(browser),
        WecomLoginState.expires_at > now(),
    ).returning(WecomLoginState.next_path)).scalar_one_or_none()
    db.commit()
    if next_path is None:
        raise HTTPException(400, "企业微信登录已过期或已使用，请重新从工作台进入")
    identity = provider_get("auth/getuserinfo", {"access_token": access_token(settings), "code": code})
    userid = identity.get("userid") or identity.get("UserId")
    if not userid:
        raise HTTPException(403, "仅本企业成员可访问 PPT 智造")
    user = db.scalar(select(User).join(WecomIdentity, WecomIdentity.user_id == User.id).where(
        WecomIdentity.corp_id == settings["CORP_ID"], WecomIdentity.wecom_userid == userid))
    if not user or not user.active:
        raise HTTPException(403, "账号尚未关联或已停用，请联系管理员")
    token = secrets.token_urlsafe(32)
    db.add(LoginSession(token_hash=token_hash(token), user_id=user.id, expires_at=now()+timedelta(hours=12),
                        auth_provider="wecom", auth_corp_id=settings["CORP_ID"]))
    audit(db, user, "auth.wecom.login", user.id)
    db.commit()
    response = RedirectResponse(safe_next(next_path), status_code=303)
    response.set_cookie("quark_session", token, httponly=True, secure=True, samesite="lax", max_age=43200)
    response.delete_cookie(STATE_COOKIE, path="/api/auth/wecom", secure=True, httponly=True, samesite="lax")
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


class Binding(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    wecom_userid: str = Field(min_length=1, max_length=128)


@router.put("/bindings")
def bind_members(bindings: list[Binding], u=Depends(current_user), db=Depends(db_session)):
    admin(u)
    settings = config()
    if not 1 <= len(bindings) <= 1000:
        raise HTTPException(422, "请提交 1 至 1000 条账号对应关系")
    if len({b.username for b in bindings}) != len(bindings) or len({b.wecom_userid for b in bindings}) != len(bindings):
        raise HTTPException(422, "对应表中账号或 UserID 重复")
    for binding in bindings:
        user = db.scalar(select(User).where(User.username == binding.username))
        if not user:
            raise HTTPException(422, "对应表包含不存在的系统账号")
        row = db.scalar(select(WecomIdentity).where(WecomIdentity.corp_id == settings["CORP_ID"],
                                                   WecomIdentity.user_id == user.id))
        if row:
            if row.wecom_userid != binding.wecom_userid:
                db.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
            row.wecom_userid = binding.wecom_userid
        else:
            db.add(WecomIdentity(corp_id=settings["CORP_ID"], wecom_userid=binding.wecom_userid, user_id=user.id))
        audit(db, u, "auth.wecom.bind", user.id)
    db.commit()
    return {"bound": len(bindings)}
