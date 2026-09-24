import hashlib, secrets, base64
from datetime import datetime, timezone
from fastapi import Request, HTTPException, Depends
from sqlalchemy import select, or_
from .db import SessionLocal, User, LoginSession, Project, Member, Booklet


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


def current_user(request: Request, db=Depends(db_session)):
    token = request.cookies.get("quark_session", "")
    session = db.scalar(
        select(LoginSession).where(
            LoginSession.token_hash == token_hash(token),
            LoginSession.expires_at > datetime.now(timezone.utc),
        )
    )
    user = db.get(User, session.user_id) if session else None
    if not user or not user.active:
        raise HTTPException(401, "请先登录")
    # Same-origin mutation guard; the Vite/nginx proxy retains the browser origin.
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        import os

        origin = request.headers.get("origin")
        allowed = os.getenv("WEB_ORIGIN", "http://localhost:5174").split(",")
        if origin and origin not in allowed:
            raise HTTPException(403, "不允许此来源的写入请求")
    return user


def admin(user):
    if user.role != "admin":
        raise HTTPException(403, "需要管理员权限")


def project_access(db, user, pid, write=False):
    p = db.get(Project, pid)
    if not p or p.status == "deleted":
        raise HTTPException(404, "项目不存在或已删除")
    if user.role == "admin":
        return p
    if write:
        if user.role != "business" or p.business_id != user.id:
            raise HTTPException(403, "仅项目商务负责人可执行")
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
    # Project membership does not grant a contributor access to another
    # contributor's assigned working pages.
    if user.role == "contributor" and b.owner_id != user.id:
        raise HTTPException(403, "只能访问分配给您的分册")
    if write and b.owner_id != user.id:
        raise HTTPException(403, "只有被指派人员可编辑此分册")
    return b
