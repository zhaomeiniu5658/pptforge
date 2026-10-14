import hashlib, secrets, base64, os
from datetime import datetime, timezone
from urllib.parse import urlsplit
from fastapi import Request, HTTPException, Depends
from sqlalchemy import select, or_
from .db import SessionLocal, User, LoginSession, Project, Member, Booklet, WecomIdentity


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1)
    return base64.b64encode(salt + digest).decode()


def verify_password(password, stored):
    raw = base64.b64decode(stored)
    return secrets.compare_digest(
        hashlib.scrypt(password.encode(), salt=raw[:16], n=16384, r=8, p=1), raw[16:]
    )


def token_hash(t):
    return hashlib.sha256(t.encode()).hexdigest()


def db_session():
    with SessionLocal() as db:
        yield db


def require_wecom_client(request):
    # Client gate improves routing; authentication relies on server-verified OAuth,
    # never on this forgeable User-Agent string alone.
    if "wxwork" not in request.headers.get("user-agent", "").lower():
        raise HTTPException(403, "请通过企业微信工作台进入 PPT 智造")


def local_login_allowed(request):
    if request is None or os.getenv("LOCAL_SYSTEM_LOGIN", "false").lower() != "true":
        return False
    # A deliberate temporary mode for putting the site in the WeCom workbench
    # before OAuth trusted-domain verification is available. Keep it off in the
    # production example; when enabled, system-password sessions remain the
    # authentication method until WeCom OAuth is turned back on.
    if os.getenv("PUBLIC_SYSTEM_LOGIN", "false").lower() == "true":
        return True
    if os.getenv("APP_ENV") != "local":
        return False
    loopback = {"localhost", "127.0.0.1", "::1"}
    origin = request.headers.get("origin")
    return (request.client is not None and request.client.host in loopback
            and request.url.hostname in loopback
            and (not origin or urlsplit(origin).hostname in loopback))


def current_user(request: Request, db=Depends(db_session)):
    local_allowed = local_login_allowed(request)
    if not local_allowed:
        require_wecom_client(request)
    token = request.cookies.get("quark_session", "")
    session = db.scalar(
        select(LoginSession).where(
            LoginSession.token_hash == token_hash(token),
            LoginSession.expires_at > datetime.now(timezone.utc),
        )
    )
    corp_id = os.getenv("WECOM_CORP_ID", "").strip()
    local_session = session and session.auth_provider == "local_test" and local_allowed
    if not local_session and (not session or session.auth_provider != "wecom" or not corp_id
            or session.auth_corp_id != corp_id):
        raise HTTPException(401, "请通过企业微信验证身份")
    if not local_session and not db.scalar(select(WecomIdentity.id).where(
            WecomIdentity.user_id == session.user_id, WecomIdentity.corp_id == corp_id)):
        raise HTTPException(401, "企业微信身份关联已失效，请联系管理员")
    user = db.get(User, session.user_id) if session else None
    if not user or not user.active:
        raise HTTPException(401, "请先登录")
    # Same-origin mutation guard; the Vite/nginx proxy retains the browser origin.
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        allowed = os.getenv("WEB_ORIGIN", "http://localhost:5174").split(",")
        if origin and origin not in allowed:
            raise HTTPException(403, "不允许此来源的写入请求")
    return user


def admin(user):
    if user.role != "admin":
        raise HTTPException(403, "需要管理员权限")


def business_or_admin(user, project=None):
    """Return whether the user has project-manager permissions.

    Administrators inherit the business role for project operations. When a
    project is supplied, ordinary business users remain scoped to projects
    they own while administrators can manage any accessible project.
    """
    if user.role == "admin":
        return True
    return user.role == "business" and (
        project is None or project.business_id == user.id
    )


def project_access(db, user, pid, write=False):
    p = db.get(Project, pid)
    if not p or p.status == "deleted":
        raise HTTPException(404, "项目不存在或已删除")
    if user.role == "admin":
        return p
    if write:
        if not business_or_admin(user, p):
            raise HTTPException(403, "仅项目商务负责人或管理员可执行")
    elif (
        p.business_id != user.id
        and p.leader_id != user.id
        and not db.scalar(
            select(Member).where(Member.project_id == pid, Member.user_id == user.id)
        )
    ):
        raise HTTPException(403, "无权访问项目")
    return p


def booklet_access(db, user, bid, write=False):
    b = db.get(Booklet, bid)
    if not b:
        raise HTTPException(404, "分册不存在")
    project_access(db, user, b.project_id)
    if user.role == "admin":
        return b
    # Project membership does not grant a contributor access to another
    # contributor's assigned working pages.
    if user.role == "contributor" and b.owner_id != user.id:
        raise HTTPException(403, "只能访问分配给您的分册")
    if write and b.owner_id != user.id:
        raise HTTPException(403, "只有被指派人员可编辑此分册")
    return b
