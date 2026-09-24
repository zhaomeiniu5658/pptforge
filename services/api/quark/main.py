import os, secrets, json, asyncio, base64, io, zipfile, mimetypes, re
from urllib.parse import quote
from pathlib import Path
from datetime import timedelta
from contextlib import asynccontextmanager
from typing import Literal
from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    Request,
    Response,
    UploadFile,
    File,
    Form,
)
from fastapi.responses import FileResponse, StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import select, func, or_
from sqlalchemy.exc import IntegrityError
from .db import *
from .security import *
from .content import store_asset, audit, normalize, tool, asset_data
from .exports import bundle
from .seed import seed, document
from .model_profiles import router as models_router, seed_env_model, resolve_model


@asynccontextmanager
async def lifespan(app):
    Base.metadata.create_all(bind=engine)
    seed()
    seed_env_model()
    yield


app = FastAPI(title="Quarkmed Workbench API", lifespan=lifespan)
app.include_router(models_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("WEB_ORIGIN", "http://localhost:5174").split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["content-type"],
)


@app.exception_handler(IntegrityError)
async def conflict(req, exc):
    return __import__("fastapi").responses.JSONResponse(
        status_code=409, content={"detail": "名称或编号已存在，请检查后重试"}
    )


@app.exception_handler(ValueError)
async def invalid(req, exc):
    return __import__("fastapi").responses.JSONResponse(
        status_code=422, content={"detail": str(exc)}
    )


DB = Depends(db_session)
USER = Depends(current_user)


class LoginIn(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login")
def login(body: LoginIn, response: Response, db=DB):
    u = db.scalar(
        select(User).where(User.username == body.username, User.active == True)
    )
    if not u or not verify_password(body.password, u.password_hash):
        raise HTTPException(401, "账号或密码错误")
    t = secrets.token_urlsafe(32)
    db.add(
        LoginSession(
            user_id=u.id,
            token_hash=token_hash(t),
            expires_at=now() + timedelta(hours=12),
        )
    )
    db.commit()
    response.set_cookie(
        "quark_session",
        t,
        httponly=True,
        samesite="lax",
        secure=os.getenv("COOKIE_SECURE", "false") == "true",
        max_age=43200,
    )
    return asdict(u)


@app.post("/api/auth/logout")
def logout(req: Request, res: Response, u=USER, db=DB):
    s = db.scalar(
        select(LoginSession).where(
            LoginSession.token_hash == token_hash(req.cookies.get("quark_session", ""))
        )
    )
    if s:
        db.delete(s)
        db.commit()
    res.delete_cookie("quark_session")
    return {"ok": True}


@app.get("/api/me")
def me(u=USER):
    return asdict(u)


def platform_settings(db):
    if not hasattr(db, "scalar"):
        return {"ai_enabled": True}
    row = db.scalar(select(PlatformSetting).where(PlatformSetting.key == "features"))
    if not row:
        row = PlatformSetting(key="features", value={"ai_enabled": True})
        db.add(row)
        db.commit()
        db.refresh(row)
    value = row.value or {}
    return {"ai_enabled": value.get("ai_enabled", True)}


def require_ai_enabled(db):
    if not platform_settings(db)["ai_enabled"]:
        raise HTTPException(403, "AI 功能已关闭，请联系管理员开启")


class SettingsPatch(BaseModel):
    ai_enabled: bool | None = None


@app.get("/api/settings")
def get_settings(u=USER, db=DB):
    return platform_settings(db)


@app.patch("/api/settings")
def patch_settings(b: SettingsPatch, u=USER, db=DB):
    admin(u)
    row = db.scalar(select(PlatformSetting).where(PlatformSetting.key == "features"))
    if not row:
        row = PlatformSetting(key="features", value={"ai_enabled": True})
        db.add(row)
        db.flush()
    value = dict(row.value or {})
    if b.ai_enabled is not None:
        value["ai_enabled"] = b.ai_enabled
    row.value = value
    audit(db, u, "settings.update", row.id, {"value": value})
    db.commit()
    return platform_settings(db)


@app.get("/api/health")
def health(db=DB):
    db.execute(select(1))
    return {"ok": True, "database": "postgresql"}


@app.get("/api/departments")
def departments(u=USER, db=DB):
    return [asdict(x) for x in db.scalars(select(Department).order_by(Department.name))]


class DepartmentIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    parent_id: str | None = None


@app.post("/api/departments")
def create_department(b: DepartmentIn, u=USER, db=DB):
    admin(u)
    if b.parent_id and not db.get(Department, b.parent_id):
        raise HTTPException(422, "上级部门不存在")
    d = Department(**b.model_dump())
    db.add(d)
    db.commit()
    return asdict(d)


@app.get("/api/users")
def users(u=USER, db=DB):
    return [asdict(x) for x in db.scalars(select(User).order_by(User.name))]


class UserIn(BaseModel):
    username: str = Field(min_length=2, max_length=100)
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=128)
    role: Literal["admin", "business", "contributor"] = "contributor"
    department_id: str | None = None
    employee_no: str = ""


@app.post("/api/users")
def create_user(b: UserIn, u=USER, db=DB):
    admin(u)
    if b.department_id and not db.get(Department, b.department_id):
        raise HTTPException(422, "部门不存在")
    d = b.model_dump()
    password = d.pop("password")
    x = User(**d, password_hash=hash_password(password))
    db.add(x)
    db.flush()
    audit(db, u, "user.create", x.id)
    db.commit()
    return asdict(x)


class UserPatch(BaseModel):
    active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


@app.patch("/api/users/{id}")
def patch_user(id: str, b: UserPatch, u=USER, db=DB):
    admin(u)
    x = db.get(User, id)
    if not x:
        raise HTTPException(404, "用户不存在")
    if b.active is not None:
        if x.id == u.id and not b.active:
            raise HTTPException(422, "不能停用当前账号")
        x.active = b.active
    if b.password:
        x.password_hash = hash_password(b.password)
    audit(db, u, "user.update", x.id)
    db.commit()
    return asdict(x)


@app.get("/api/template-categories")
def categories(u=USER, db=DB):
    return [
        {
            **asdict(x),
            "count": db.scalar(
                select(func.count())
                .select_from(Template)
                .where(Template.category_id == x.id, Template.status != "deleted")
            ),
        }
        for x in db.scalars(select(Category).order_by(Category.position))
    ]


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    active: bool = True


@app.post("/api/template-categories")
def create_category(b: CategoryIn, u=USER, db=DB):
    admin(u)
    x = Category(
        **b.model_dump(), position=db.scalar(select(func.count()).select_from(Category))
    )
    db.add(x)
    db.commit()
    return asdict(x)


@app.patch("/api/template-categories/{id}")
def patch_category(id: str, b: CategoryIn, u=USER, db=DB):
    admin(u)
    x = db.get(Category, id)
    if not x:
        raise HTTPException(404, "分类不存在")
    x.name = b.name
    x.active = b.active
    audit(db, u, "category.update", id)
    db.commit()
    return asdict(x)


def page_out(db, p):
    r = db.get(Revision, p.current_revision_id)
    return {
        **asdict(p),
        "document": r.document if r else {},
        "revision": asdict(r) if r else None,
    }


def booklet_out(db, b, with_pages=False):
    pages = list(
        db.scalars(
            select(Page)
            .where(Page.booklet_id == b.id, Page.deleted == False)
            .order_by(Page.position, Page.created_at)
        )
    )
    sub = db.get(Submission, b.latest_submission_id) if b.latest_submission_id else None
    changed = bool(
        sub
        and sub.manifest
        != [
            {"page_id": p.id, "revision_id": p.current_revision_id, "title": p.title}
            for p in pages
        ]
    )
    return {
        **asdict(b),
        "page_count": len(pages),
        "submission": asdict(sub) if sub else None,
        "has_new_draft": changed,
        "pages": [page_out(db, p) for p in pages] if with_pages else [],
    }


def project_out(db, p, viewer=None):
    bs = [
        booklet_out(db, b)
        for b in db.scalars(
            select(Booklet).where(Booklet.project_id == p.id).order_by(Booklet.position)
        )
    ]
    if viewer is not None and viewer.role == "contributor":
        bs = [b for b in bs if b["owner_id"] == viewer.id]
    booklet_ids = [b["id"] for b in bs]
    latest_snapshot = db.scalar(select(func.max(BookletSnapshot.created_at)).where(
        BookletSnapshot.booklet_id.in_(booklet_ids))) if booklet_ids else None
    latest_review = db.scalar(select(func.max(Submission.reviewed_at)).where(
        Submission.booklet_id.in_(booklet_ids))) if booklet_ids else None
    updated = max(x for x in [p.created_at, latest_snapshot, latest_review] if x)
    return {
        **asdict(p),
        "updated_at": updated.isoformat(),
        "booklets": bs,
        "members": [
            asdict(m)
            for m in db.scalars(select(Member).where(Member.project_id == p.id))
        ],
        "approved": sum(
            bool(b["submission"] and b["submission"]["status"] == "approved")
            for b in bs
        ),
        "page_count": sum(b["page_count"] for b in bs),
    }


@app.get("/api/projects")
def projects(u=USER, db=DB):
    q = select(Project).where(Project.status != "deleted").order_by(Project.created_at.desc())
    if u.role != "admin":
        q = q.where(
            or_(
                Project.business_id == u.id,
                Project.leader_id == u.id,
                Project.id.in_(select(Member.project_id).where(Member.user_id == u.id)),
            )
        )
    return [project_out(db, p, u) for p in db.scalars(q)]


class AssignmentIn(BaseModel):
    user_id: str
    title: str = Field(min_length=1, max_length=200)
    instructions: str = ""
    expected_pages: int = Field(default=4, ge=1, le=200)


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    code: str = ""
    description: str = ""
    field: str = "医学"
    project_type: str = Field(default="", max_length=160)
    bid_date: str = Field(default="", max_length=10)
    # Kept optional for compatibility with older clients and historical requests.
    start_date: str = Field(default="", max_length=10)
    leader_phone: str = Field(default="", max_length=80)
    leader_email: str = Field(default="", max_length=254)
    deadline: str = ""
    leader_id: str
    assignments: list[AssignmentIn] = Field(min_length=1)


class ProjectUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    project_type: str = Field(default="", max_length=160)
    bid_date: str = Field(default="", max_length=10)
    deadline: str = ""
    leader_id: str
    leader_phone: str = Field(default="", max_length=80)
    leader_email: str = Field(default="", max_length=254)


@app.put("/api/projects/{id}")
def update_project(id: str, b: ProjectUpdate, u=USER, db=DB):
    p = project_access(db, u, id, True)
    if u.role != "business" or p.business_id != u.id:
        raise HTTPException(403, "仅项目商务负责人可编辑")
    leader = db.get(User, b.leader_id)
    if not leader or not leader.active:
        raise HTTPException(422, "所选负责人不存在或已停用")
    if b.bid_date:
        try:
            __import__("datetime").date.fromisoformat(b.bid_date)
        except ValueError:
            raise HTTPException(422, "项目投标日期格式不正确")
        deadline_value = b.deadline or b.bid_date + "T23:59:59Z"
    else:
        deadline_value = p.deadline
    if b.leader_email and not __import__("re").fullmatch(
        r"[^\s@]+@[^\s@]+\.[^\s@]+", b.leader_email
    ):
        raise HTTPException(422, "负责人企业邮箱格式不正确")
    p.name = b.name
    p.description = b.description
    p.project_type = b.project_type
    p.bid_date = b.bid_date
    p.leader_id = b.leader_id
    p.leader_phone = b.leader_phone
    p.leader_email = b.leader_email
    p.deadline = deadline_value
    for booklet in db.scalars(select(Booklet).where(Booklet.project_id == p.id)):
        booklet.deadline = deadline_value
    member = db.scalar(
        select(Member).where(Member.project_id == p.id, Member.user_id == b.leader_id)
    )
    if not member:
        db.add(Member(project_id=p.id, user_id=b.leader_id, responsibility="项目负责人"))
    audit(db, u, "project.update", p.id)
    db.commit()
    return project_out(db, p)


@app.post("/api/projects")
def create_project(b: ProjectIn, u=USER, db=DB):
    if u.role != "business":
        raise HTTPException(403, "需要商务权限")
    for id in [b.leader_id] + [a.user_id for a in b.assignments]:
        person = db.get(User, id)
        if not person or not person.active:
            raise HTTPException(422, "所选人员不存在或已停用")
    bid_date = b.bid_date
    if bid_date:
        try:
            bid_day = __import__("datetime").date.fromisoformat(bid_date)
        except ValueError:
            raise HTTPException(422, "项目投标日期格式不正确")
    elif b.start_date:
        # Compatibility fallback for requests created before the bid date field.
        bid_date = b.start_date
        try:
            bid_day = __import__("datetime").date.fromisoformat(bid_date)
        except ValueError:
            raise HTTPException(422, "项目开始日期格式不正确")
    else:
        bid_day = None
    deadline_value = b.deadline or (
        bid_date + "T23:59:59Z" if bid_date else ""
    )
    if not deadline_value:
        raise HTTPException(422, "项目投标日期不能为空")
    try:
        deadline = __import__("datetime").datetime.fromisoformat(
            deadline_value.replace("Z", "+00:00")
        )
    except ValueError:
        raise HTTPException(422, "截止时间格式不正确")
    if not b.bid_date and b.start_date and bid_day > deadline.date():
        raise HTTPException(422, "预计结束日期不能早于项目开始日期")
    if b.leader_email and not __import__("re").fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", b.leader_email):
        raise HTTPException(422, "负责人企业邮箱格式不正确")
    p = Project(
        name=b.name,
        code=b.code.strip()
        or "QM-" + now().strftime("%Y%m%d") + "-" + secrets.token_hex(2).upper(),
        description=b.description,
        field=b.field,
        project_type=b.project_type,
        bid_date=bid_date,
        start_date=b.start_date,
        leader_phone=b.leader_phone,
        leader_email=b.leader_email,
        deadline=deadline_value,
        leader_id=b.leader_id,
        business_id=u.id,
    )
    db.add(p)
    db.flush()
    ids = set([b.leader_id] + [a.user_id for a in b.assignments])
    for id in ids:
        db.add(
            Member(
                project_id=p.id,
                user_id=id,
                responsibility="项目负责人" if id == b.leader_id else "分册编写",
            )
        )
    for i, a in enumerate(b.assignments):
        db.add(
            Booklet(
                project_id=p.id,
                owner_id=a.user_id,
                title=a.title,
                deadline=deadline_value,
                instructions=a.instructions,
                expected_pages=a.expected_pages,
                position=i,
            )
        )
        db.add(
            Notification(
                user_id=a.user_id,
                project_id=p.id,
                message="新任务：" + p.name + " / " + a.title,
            )
        )
    audit(db, u, "project.create", p.id)
    db.commit()
    return project_out(db, p)


@app.get("/api/projects/{id}")
def get_project(id: str, u=USER, db=DB):
    result = project_out(db, project_access(db, u, id), u)
    for b in result["booklets"]:
        pages = list(
            db.scalars(
                select(Page)
                .where(Page.booklet_id == b["id"], Page.deleted == False)
                .order_by(Page.position)
                .limit(4)
            )
        )
        b["previews"] = [
            {
                "id": p.id,
                "title": p.title,
                "document": db.get(Revision, p.current_revision_id).document,
            }
            for p in pages
        ]
    return result


@app.delete("/api/projects/{id}")
def delete_project(id: str, u=USER, db=DB):
    p = project_access(db, u, id)
    if u.role != "business" or p.business_id != u.id:
        raise HTTPException(403, "仅项目商务负责人可删除")
    db.refresh(p, with_for_update=True)
    if p.status == "deleted":
        raise HTTPException(404, "项目不存在或已删除")
    p.status = "deleted"
    p.version += 1
    audit(db, u, "project.delete", id)
    db.commit()
    return {"ok": True}


class OrderIn(BaseModel):
    ids: list[str]
    version: int


@app.put("/api/projects/{id}/booklets")
def reorder_booklets(id: str, b: OrderIn, u=USER, db=DB):
    p = project_access(db, u, id, True)
    db.refresh(p, with_for_update=True)
    rows = list(db.scalars(select(Booklet).where(Booklet.project_id == id)))
    if p.version != b.version:
        raise HTTPException(409, "项目已变化，请刷新")
    if len(b.ids) != len(set(b.ids)) or set(b.ids) != {x.id for x in rows}:
        raise HTTPException(422, "分册顺序无效")
    for x in rows:
        x.position = b.ids.index(x.id)
    p.version += 1
    audit(db, u, "project.reorder", id, {"booklet_ids": b.ids, "version": p.version})
    db.commit()
    return project_out(db, p)


@app.post("/api/projects/{id}/remind")
def remind(id: str, u=USER, db=DB):
    project_access(db, u, id, True)
    count = 0
    for b in db.scalars(select(Booklet).where(Booklet.project_id == id)):
        s = (
            db.get(Submission, b.latest_submission_id)
            if b.latest_submission_id
            else None
        )
        if not s or s.status != "approved":
            db.add(
                Notification(
                    user_id=b.owner_id,
                    project_id=id,
                    message="商务催办：请及时完成「" + b.title + "」",
                )
            )
            count += 1
    db.commit()
    return {"count": count}


@app.get("/api/booklets/{id}")
def get_booklet(id: str, u=USER, db=DB):
    return booklet_out(db, booklet_access(db, u, id), True)


class DocumentIn(BaseModel):
    title: str = Field(default="新页面", min_length=1, max_length=200)
    document: dict
    base_revision_id: str | None = None


def snapshot_booklet(db, u, b, reason):
    db.flush()
    pages = list(
        db.scalars(
            select(Page)
            .where(Page.booklet_id == b.id, Page.deleted == False)
            .order_by(Page.position, Page.created_at)
        )
    )
    db.add(
        BookletSnapshot(
            booklet_id=b.id,
            actor_id=u.id,
            version=b.version,
            reason=reason,
            manifest=[
                {
                    "page_id": p.id,
                    "revision_id": p.current_revision_id,
                    "title": p.title,
                }
                for p in pages
            ],
        )
    )
    audit(db, u, "booklet." + reason, b.id, {"version": b.version})


def add_page(db, u, b, title, doc, source="manual", template_version_id=None):
    p = Page(
        booklet_id=b.id,
        title=title,
        position=db.scalar(
            select(func.count()).select_from(Page).where(Page.booklet_id == b.id)
        ),
        template_version_id=template_version_id,
    )
    db.add(p)
    db.flush()
    r = Revision(page_id=p.id, document=doc, actor_id=u.id, source=source)
    db.add(r)
    db.flush()
    p.current_revision_id = r.id
    b.version += 1
    audit(db, u, "page.create", p.id)
    return p


@app.post("/api/booklets/{id}/pages")
def create_page(id: str, data: DocumentIn, u=USER, db=DB):
    b = booklet_access(db, u, id, True)
    db.refresh(b, with_for_update=True)
    doc = normalize(data.document)
    p = add_page(db, u, b, data.title, doc)
    snapshot_booklet(db, u, b, "add")
    db.commit()
    return page_out(db, p)


@app.put("/api/booklets/{id}/pages/order")
def reorder_pages(id: str, data: OrderIn, u=USER, db=DB):
    b = booklet_access(db, u, id, True)
    db.refresh(b, with_for_update=True)
    rows = list(
        db.scalars(select(Page).where(Page.booklet_id == id, Page.deleted == False))
    )
    if data.version != b.version:
        raise HTTPException(409, "页面列表已变化，请刷新")
    if len(data.ids) != len(set(data.ids)) or set(data.ids) != {x.id for x in rows}:
        raise HTTPException(422, "页面顺序无效")
    for p in rows:
        p.position = data.ids.index(p.id)
    b.version += 1
    snapshot_booklet(db, u, b, "reorder")
    db.commit()
    return booklet_out(db, b, True)


@app.post("/api/pages/{id}/revisions")
def save_page(id: str, data: DocumentIn, u=USER, db=DB):
    p = db.get(Page, id)
    if not p or p.deleted:
        raise HTTPException(404, "页面不存在")
    b = booklet_access(db, u, p.booklet_id, True)
    db.refresh(b, with_for_update=True)
    db.refresh(p, with_for_update=True)
    if p.current_revision_id != data.base_revision_id:
        raise HTTPException(409, "页面已被更新，请刷新后合并修改")
    doc = normalize(data.document)
    r = Revision(
        page_id=id, actor_id=u.id, document=doc, base_revision_id=p.current_revision_id
    )
    db.add(r)
    db.flush()
    p.current_revision_id = r.id
    p.title = data.title
    b.version += 1
    audit(db, u, "page.save", id)
    snapshot_booklet(db, u, b, "save")
    db.commit()
    return page_out(db, p)


@app.get("/api/pages/{id}/revisions")
def page_history(id: str, u=USER, db=DB):
    p = db.get(Page, id)
    if not p:
        raise HTTPException(404, "页面不存在")
    booklet_access(db, u, p.booklet_id)
    return [
        asdict(r)
        for r in db.scalars(
            select(Revision)
            .where(Revision.page_id == id)
            .order_by(Revision.created_at.desc())
        )
    ]


@app.delete("/api/pages/{id}")
def delete_page(id: str, u=USER, db=DB):
    p = db.get(Page, id)
    if not p:
        raise HTTPException(404, "页面不存在")
    b = booklet_access(db, u, p.booklet_id, True)
    db.refresh(b, with_for_update=True)
    p.deleted = True
    b.version += 1
    audit(db, u, "page.remove", id)
    snapshot_booklet(db, u, b, "remove")
    db.commit()
    return {"ok": True}


@app.post("/api/booklets/{id}/submissions")
def submit(id: str, u=USER, db=DB):
    b = booklet_access(db, u, id, True)
    db.refresh(b, with_for_update=True)
    pages = list(
        db.scalars(
            select(Page)
            .where(Page.booklet_id == id, Page.deleted == False)
            .order_by(Page.position, Page.created_at)
        )
    )
    if not pages:
        raise HTTPException(422, "分册至少需要一个页面")
    for p in pages:
        d = db.get(Revision, p.current_revision_id).document
        if any(x.get("severity") == "error" for x in d.get("diagnostics", [])):
            raise HTTPException(422, "存在未处理的页面转换问题，不能提交")
    s = Submission(
        booklet_id=id,
        actor_id=u.id,
        manifest=[
            {"page_id": p.id, "revision_id": p.current_revision_id, "title": p.title}
            for p in pages
        ],
        status="approved",
        reviewer_id=u.id,
        reviewed_at=now(),
    )
    db.add(s)
    db.flush()
    b.latest_submission_id = s.id
    p = db.get(Project, b.project_id)
    db.add(
        Notification(
            user_id=p.business_id, project_id=p.id, message="分册已确认：" + b.title
        )
    )
    audit(db, u, "booklet.confirm", id, {"submission_id": s.id})
    db.commit()
    return asdict(s)


class ReviewIn(BaseModel):
    decision: Literal["approved", "returned"]
    comment: str = ""


@app.post("/api/submissions/{id}/review")
def review(id: str, b: ReviewIn, u=USER, db=DB):
    s = db.get(Submission, id)
    if not s:
        raise HTTPException(404, "提交不存在")
    bk = db.get(Booklet, s.booklet_id)
    p = project_access(db, u, bk.project_id, True)
    if u.role != "business" or p.business_id != u.id:
        raise HTTPException(403, "必须由项目商务负责人处理")
    db.refresh(s, with_for_update=True)
    if s.status != "submitted" or bk.latest_submission_id != s.id:
        raise HTTPException(409, "此提交已确认或已被新提交替代")
    if b.decision == "returned" and not b.comment.strip():
        raise HTTPException(422, "退回时请填写修改意见")
    s.status = b.decision
    s.review_comment = b.comment
    s.reviewer_id = u.id
    s.reviewed_at = now()
    db.add(
        Notification(
            user_id=bk.owner_id,
            project_id=p.id,
            message=("确认完成：" if b.decision == "approved" else "退回修改：")
            + bk.title
            + " "
            + b.comment,
        )
    )
    audit(db, u, "submission." + b.decision, id)
    db.commit()
    return asdict(s)


@app.get("/api/submissions/{id}")
def submission(id: str, u=USER, db=DB):
    s = db.get(Submission, id)
    if not s:
        raise HTTPException(404, "提交不存在")
    booklet_access(db, u, s.booklet_id)
    return {
        **asdict(s),
        "pages": [
            {
                "title": x["title"],
                "document": db.get(Revision, x["revision_id"]).document,
            }
            for x in s.manifest
        ],
    }


@app.get("/api/templates")
def templates(u=USER, db=DB):
    q = select(Template).where(Template.status != "deleted").order_by(Template.created_at.desc())
    if u.role != "admin":
        q = q.where(
            Template.active == True,
            Template.status == "published",
            or_(Template.shared == True, Template.department_id == u.department_id),
            Template.category_id.in_(
                select(Category.id).where(Category.active == True)
            ),
        )
    out = []
    for t in db.scalars(q):
        v = (
            db.get(TemplateVersion, t.current_version_id)
            if t.current_version_id
            else None
        )
        out.append(
            {
                **asdict(t),
                "documents": v.documents if v else [],
                "diagnostics": v.diagnostics if v else [],
                "published": v.published if v else False,
            }
        )
    return out


def template_for_download(db, u, template_id):
    t = db.get(Template, template_id)
    if not t or t.status == "deleted":
        raise HTTPException(404, "模板不存在")
    if u.role != "admin" and (
        not t.active
        or t.status != "published"
        or (not t.shared and t.department_id != u.department_id)
        or not db.scalar(select(Category).where(Category.id == t.category_id, Category.active == True))
    ):
        raise HTTPException(403, "模板不可下载")
    v = db.get(TemplateVersion, t.current_version_id) if t.current_version_id else None
    if not v or not v.documents:
        raise HTTPException(422, "模板没有可下载内容")
    if any(x.get("severity") == "error" for x in (v.diagnostics or [])):
        raise HTTPException(422, "模板存在未解决的转换错误，暂不能下载")
    return t, v


def safe_download_name(name):
    value = re.sub(r'[\\/:*?"<>|]+', "_", (name or "template").strip())
    return (value or "template")[:100]


def attachment_header(filename):
    return f'attachment; filename="quarkmed-template.zip"; filename*=UTF-8\'\'{quote(filename)}'


def template_archive(db, t, v):
    pages = [
        {"title": f"{t.name} · 第 {index + 1} 页", "document": document}
        for index, document in enumerate(v.documents)
    ]
    compiled = tool(
        "/internal/compile",
        {"pages": pages, "options": {"title": t.name, "navigation": True}},
    )
    if any(x.get("severity") == "error" for x in compiled.get("diagnostics", [])):
        raise HTTPException(422, "模板存在未归档资源，下载已中止")
    manifest = {
        "template": t.name,
        "template_id": t.id,
        "version_id": v.id,
        "pages": [{"title": page["title"]} for page in pages],
    }
    return bundle(compiled["html"], [
        tool(
            "/internal/compile",
            {"pages": [page], "options": {"navigation": False}},
        )["html"]
        for page in pages
    ], manifest)


class TemplateDownloadIn(BaseModel):
    template_ids: list[str] = Field(min_length=1, max_length=60)


@app.post("/api/templates/download")
def download_templates(b: TemplateDownloadIn, u=USER, db=DB):
    archives = []
    seen = set()
    for template_id in b.template_ids:
        if template_id in seen:
            continue
        seen.add(template_id)
        t, v = template_for_download(db, u, template_id)
        archives.append((safe_download_name(t.name), template_archive(db, t, v), t.id, v.id))
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        used_names = set()
        for name, data, template_id, version_id in archives:
            candidate = name
            suffix = 2
            while candidate in used_names:
                candidate = f"{name}-{suffix}"
                suffix += 1
            used_names.add(candidate)
            archive.writestr(f"{candidate}.zip", data)
            audit(db, u, "template.download", template_id, {"version_id": version_id, "batch": True})
        archive.writestr(
            "manifest.json",
            json.dumps(
                {"count": len(archives), "templates": [{"name": n} for n, _, _, _ in archives]},
                ensure_ascii=False,
                indent=2,
            ),
        )
    db.commit()
    return Response(
        content=output.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="quarkmed-templates.zip"'},
    )


@app.get("/api/templates/{id}/download")
def download_template(id: str, u=USER, db=DB):
    t, v = template_for_download(db, u, id)
    data = template_archive(db, t, v)
    filename = safe_download_name(t.name) + ".zip"
    audit(db, u, "template.download", t.id, {"version_id": v.id, "batch": False})
    db.commit()
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": attachment_header(filename)},
    )


class TemplatePatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    active: bool | None = None
    category_id: str | None = None
    department_id: str | None = None
    shared: bool | None = None


class TemplateContentPatch(BaseModel):
    documents: list[dict] = Field(min_length=1, max_length=60)
    base_version_id: str | None


@app.patch("/api/templates/{id}")
def patch_template(id: str, b: TemplatePatch, u=USER, db=DB):
    admin(u)
    t = db.scalar(select(Template).where(Template.id == id).with_for_update())
    if not t or t.status == "deleted":
        raise HTTPException(404, "模板不存在")
    if "category_id" in b.model_fields_set:
        category = db.get(Category, b.category_id) if b.category_id else None
        if not category or (not category.active and b.category_id != t.category_id):
            raise HTTPException(422, "请选择有效的模板分类")
    if b.department_id and not db.get(Department, b.department_id):
        raise HTTPException(422, "部门不存在")
    if "name" in b.model_fields_set and (b.name is None or not b.name.strip()):
        raise HTTPException(422, "模板标题不能为空")
    changes = b.model_dump(exclude_unset=True)
    if "name" in changes:
        changes["name"] = changes["name"].strip()
    if "department_id" in changes:
        changes["department_id"] = changes["department_id"] or None
    for key in ("active", "shared"):
        if key in changes and changes[key] is None:
            raise HTTPException(422, "状态不能为空")
    if changes.get("active") is True:
        version = db.get(TemplateVersion, t.current_version_id) if t.current_version_id else None
        if not version or not version.documents:
            raise HTTPException(422, "模板尚无可启用的转换结果")
        if any(x.get("severity") == "error" for x in version.diagnostics):
            raise HTTPException(422, "模板存在未解决的转换错误，暂不能启用")
        version.published = True
        t.status = "published"
    for k, v in changes.items():
        setattr(t, k, v)
    audit(
        db,
        u,
        "template.update",
        t.id,
        {"fields": list(changes), "enabled_as_published": changes.get("active") is True},
    )
    db.commit()
    return asdict(t)


@app.patch("/api/templates/{id}/content")
def patch_template_content(id: str, b: TemplateContentPatch, u=USER, db=DB):
    admin(u)
    t = db.scalar(select(Template).where(Template.id == id).with_for_update())
    if not t or t.status == "deleted":
        raise HTTPException(404, "模板不存在")
    if t.current_version_id != b.base_version_id:
        raise HTTPException(409, "模板内容已被其他操作更新，请重新载入后再保存")
    try:
        documents = [normalize(x) for x in b.documents]
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    previous = db.get(TemplateVersion, t.current_version_id) if t.current_version_id else None
    version = TemplateVersion(
        template_id=t.id,
        documents=documents,
        diagnostics=[d for doc in documents for d in doc.get("diagnostics", [])],
        source_asset_id=previous.source_asset_id if previous else None,
        published=False,
    )
    db.add(version)
    db.flush()
    t.current_version_id = version.id
    t.status = "draft"
    t.active = False
    audit(db, u, "template.content.update", t.id, {"version_id": version.id})
    db.commit()
    return {
        **asdict(t),
        "version_id": version.id,
        "documents": documents,
        "diagnostics": version.diagnostics,
        "published": False,
    }


@app.delete("/api/templates/{id}")
def delete_template(id: str, u=USER, db=DB):
    admin(u)
    t = db.scalar(select(Template).where(Template.id == id).with_for_update())
    if not t or t.status == "deleted":
        raise HTTPException(404, "模板不存在或已删除")
    # Preserve source versions/assets for existing copies and historical submissions.
    t.status = "deleted"
    t.active = False
    audit(db, u, "template.delete", id)
    db.commit()
    return {"ok": True}


@app.post("/api/templates/{id}/publish")
def publish(id: str, u=USER, db=DB):
    admin(u)
    t = db.scalar(select(Template).where(Template.id == id).with_for_update())
    if not t or t.status == "deleted":
        raise HTTPException(404, "模板不存在")
    v = db.get(TemplateVersion, t.current_version_id) if t.current_version_id else None
    if not v or not v.documents:
        raise HTTPException(422, "模板尚无转换结果")
    if any(x.get("severity") == "error" for x in v.diagnostics):
        raise HTTPException(422, "模板存在未解决的转换错误")
    v.published = True
    t.status = "published"
    audit(db, u, "template.publish", id)
    db.commit()
    return asdict(t)


class TemplateImportIn(BaseModel):
    template_ids: list[str] = Field(min_length=1, max_length=30)


@app.post("/api/booklets/{id}/templates")
def use_templates(id: str, b: TemplateImportIn, u=USER, db=DB):
    bk = booklet_access(db, u, id, True)
    db.refresh(bk, with_for_update=True)
    for tid in sorted(b.template_ids):
        # Lock all templates in stable order; preserve the requested page order below.
        db.scalar(select(Template).where(Template.id == tid).with_for_update())
    for tid in b.template_ids:
        t = db.get(Template, tid)
        if (
            not t
            or not t.active
            or t.status != "published"
            or (not t.shared and t.department_id != u.department_id)
        ):
            raise HTTPException(403, "模板不可用")
        if not db.get(Category, t.category_id).active:
            raise HTTPException(422, "模板分类已停用")
        v = db.get(TemplateVersion, t.current_version_id)
        for i, d in enumerate(v.documents):
            add_page(
                db,
                u,
                bk,
                t.name + (" · " + str(i + 1) if len(v.documents) > 1 else ""),
                normalize(d),
                "template",
                v.id,
            )
    audit(db, u, "template.use", id)
    snapshot_booklet(db, u, bk, "template_import")
    db.commit()
    return booklet_out(db, bk, True)


@app.post("/api/assets")
async def upload(
    file: UploadFile = File(...), project_id: str | None = Form(None), u=USER, db=DB
):
    if project_id:
        project_access(db, u, project_id)
    data = await file.read(32 * 1024 * 1024 + 1)
    if len(data) > 32 * 1024 * 1024:
        raise HTTPException(413, "文件不能超过 32 MB")
    a = store_asset(
        db, u.id, file.filename or "upload", data, file.content_type, project_id
    )
    db.commit()
    return asdict(a)


def allowed_asset(db, u, a):
    if not a:
        raise HTTPException(404, "文件不存在")
    if a.owner_id == u.id or u.role == "admin":
        return a
    if a.project_id:
        project_access(db, u, a.project_id)
        return a
    raise HTTPException(403, "无权访问文件")


@app.get("/api/assets/{id}")
def get_asset(id: str, u=USER, db=DB):
    a = allowed_asset(db, u, db.get(Asset, id))
    return FileResponse(
        a.path,
        media_type=a.media_type,
        filename=a.name,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


class AIIn(BaseModel):
    model_id: str | None = None
    project_id: str
    booklet_id: str
    page_id: str | None = None
    base_revision_id: str | None = None
    prompt: str = Field(min_length=1, max_length=12000)
    asset_id: str | None = None
    parent_job_id: str | None = None


class ImportIn(BaseModel):
    asset_id: str
    booklet_id: str


class TemplateAIIn(BaseModel):
    base_version_id: str | None
    prompt: str = Field(min_length=1, max_length=12000)
    mode: Literal["append", "replace"] = "append"
    page_index: int = Field(default=0, ge=0, le=59)
    document: dict | None = None
    asset_id: str | None = None
    model_id: str | None = None
    parent_job_id: str | None = None


@app.post("/api/templates/{id}/ai/tasks", status_code=202)
def template_ai_task(id: str, b: TemplateAIIn, u=USER, db=DB):
    require_ai_enabled(db)
    admin(u)
    t = db.get(Template, id)
    if not t or t.status == "deleted":
        raise HTTPException(404, "模板不存在")
    if t.current_version_id != b.base_version_id:
        raise HTTPException(409, "模板版本已变化，请重新载入后生成")
    if b.mode == "replace" and not b.document:
        raise HTTPException(422, "修改模板时必须提供当前页面草稿")
    if b.asset_id:
        asset = allowed_asset(db, u, db.get(Asset, b.asset_id))
        if not asset.media_type.startswith("image/"):
            raise HTTPException(422, "AI 参考文件必须是图片")
    if b.parent_job_id:
        parent = db.get(Job, b.parent_job_id)
        if (not parent or parent.owner_id != u.id or parent.kind != "template_ai"
                or parent.payload.get("template_id") != id
                or parent.status != "succeeded"
                or parent.payload.get("base_version_id") != b.base_version_id):
            raise HTTPException(403, "不能引用此候选任务")
    selected = resolve_model(db, b.model_id, bool(b.asset_id))
    payload = b.model_dump()
    payload.update(template_id=id, template_name=t.name,
                   model_id=selected.id, model_label=selected.name)
    return dispatch(db, u, "template_ai", payload)


def dispatch(db, u, kind, payload, pid=None):
    j = Job(owner_id=u.id, project_id=pid, kind=kind, payload=payload)
    db.add(j)
    db.flush()
    audit(db, u, "job.create", j.id, {"kind": kind})
    db.commit()
    from .tasks import execute

    try:
        execute.delay(j.id)
    except Exception:
        j.status = "failed"
        j.error = "任务队列不可用，请检查 Worker 后重试"
        db.commit()
    return asdict(j)


@app.post("/api/ai/tasks", status_code=202)
def ai_task(b: AIIn, u=USER, db=DB):
    require_ai_enabled(db)
    bk = booklet_access(db, u, b.booklet_id, True)
    if bk.project_id != b.project_id:
        raise HTTPException(422, "项目与分册不匹配")
    if b.page_id:
        pg = db.get(Page, b.page_id)
        if not pg or pg.booklet_id != bk.id:
            raise HTTPException(422, "页面不属于此分册")
        if pg.current_revision_id != b.base_revision_id:
            raise HTTPException(409, "页面版本已变化")
    if b.asset_id:
        allowed_asset(db, u, db.get(Asset, b.asset_id))
    if b.parent_job_id:
        prev = db.get(Job, b.parent_job_id)
        if not prev or prev.owner_id != u.id or prev.payload.get("booklet_id") != bk.id:
            raise HTTPException(403, "不能引用此任务")
    selected = resolve_model(db, b.model_id, bool(b.asset_id))
    payload = b.model_dump()
    payload.update(model_id=selected.id, model_label=selected.name)
    return dispatch(db, u, "ai", payload, b.project_id)


@app.post("/api/imports", status_code=202)
def html_import(b: ImportIn, u=USER, db=DB):
    bk = booklet_access(db, u, b.booklet_id, True)
    allowed_asset(db, u, db.get(Asset, b.asset_id))
    return dispatch(db, u, "html_import", b.model_dump(), bk.project_id)


@app.post("/api/templates/imports", status_code=202)
async def template_import(
    files: list[UploadFile] = File(...),
    category_id: str = Form(...),
    department_id: str | None = Form(None),
    shared: bool = Form(True),
    input_mode: Literal["files", "folder"] = Form("files"),
    template_name: str = Form(""),
    u=USER,
    db=DB,
):
    from .importers import safe_path, ignored, archive_files, html_paths, MAX_UPLOAD_SIZE, MAX_FILES
    admin(u)
    category = db.get(Category, category_id)
    if not category or not category.active:
        raise HTTPException(422, "请选择启用的模板分类")
    if department_id and not db.get(Department, department_id):
        raise HTTPException(422, "部门不存在")
    if len(files) > (MAX_FILES if input_mode == "folder" else 10):
        raise HTTPException(422, "文件夹最多 500 个文件；批量导入最多 10 个文件/压缩包")
    if len(template_name) > 200:
        raise HTTPException(422, "模板名称不能超过 200 字")
    uploads = []
    total = 0
    seen = set()
    try:
        for f in files:
            name = safe_path(f.filename or "")
            data = await f.read(MAX_UPLOAD_SIZE + 1)
            total += len(data)
            if total > MAX_UPLOAD_SIZE:
                raise HTTPException(413, "本次上传总大小超过 32 MB")
            if input_mode == "folder":
                if ignored(name):
                    continue
                if name in seen:
                    raise ValueError("文件夹包含重复路径")
                seen.add(name)
            else:
                name = Path(name).name
                if not name.lower().endswith((".pptx", ".html", ".htm", ".zip")):
                    raise ValueError("支持 PPTX、HTML、ZIP；带资源的页面请选择整个文件夹或 ZIP")
                if name.lower().endswith(".zip"):
                    html_paths(archive_files(data))
            uploads.append((name, data))
        if not uploads:
            raise ValueError("请选择可导入的文件")
        if input_mode == "folder":
            html_paths(dict(uploads))
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                for name, data in uploads:
                    z.writestr(name, data)
            folder_name = uploads[0][0].split("/")[0]
            uploads = [(folder_name + ".zip", buf.getvalue())]
    except (ValueError, zipfile.BadZipFile, RuntimeError) as exc:
        raise HTTPException(422, str(exc)) from exc
    # Validate the entire selection before scheduling any jobs.
    assets = [store_asset(db, u.id, name, data) for name, data in uploads]
    jobs = []
    for asset in assets:
        jobs.append(dispatch(db, u, "template_import", {
            "asset_id": asset.id,
            "category_id": category_id,
            "department_id": department_id,
            "shared": shared,
            "template_name": template_name.strip() if len(assets) == 1 else "",
        }))
    return jobs


@app.get("/api/jobs")
def jobs(u=USER, db=DB):
    return [
        asdict(j)
        for j in db.scalars(
            select(Job)
            .where(Job.owner_id == u.id)
            .order_by(Job.created_at.desc())
            .limit(50)
        )
    ]


def get_job(db, u, id):
    j = db.get(Job, id)
    if not j or (j.owner_id != u.id and u.role != "admin"):
        raise HTTPException(404, "任务不存在")
    if j.project_id:
        project_access(db, u, j.project_id)
    return j


def job_payload_with_events(db, j):
    payload = asdict(j)
    payload["events"] = [
        asdict(e)
        for e in db.scalars(
            select(JobEvent)
            .where(JobEvent.job_id == j.id)
            .order_by(JobEvent.created_at.asc(), JobEvent.id.asc())
        )
    ]
    return payload


@app.get("/api/jobs/{id}")
def job(id: str, u=USER, db=DB):
    return job_payload_with_events(db, get_job(db, u, id))


@app.post("/api/jobs/{id}/cancel")
def cancel(id: str, u=USER, db=DB):
    j = get_job(db, u, id)
    if j.status not in ("succeeded", "failed", "cancelled"):
        j.cancelled = True
        j.status = "cancelled"
        j.stage = "已取消"
        audit(db, u, "job.cancel", id)
        db.add(JobEvent(job_id=j.id, data={"stage": "已取消", "detail": "任务已停止，未采用任何新结果。"}))
        db.commit()
    return job_payload_with_events(db, j)


@app.post("/api/jobs/{id}/retry")
def retry(id: str, u=USER, db=DB):
    j = get_job(db, u, id)
    if j.project_id:
        project_access(db, u, j.project_id)
    if j.status not in ("failed", "cancelled"):
        raise HTTPException(409, "任务尚未失败")
    if j.payload.get("booklet_id"):
        booklet_access(db, u, j.payload["booklet_id"], True)
    if j.kind == "ai":
        require_ai_enabled(db)
        return ai_task(AIIn.model_validate(j.payload), u, db)
    if j.kind == "template_ai":
        require_ai_enabled(db)
        return template_ai_task(j.payload["template_id"], TemplateAIIn.model_validate(j.payload), u, db)
    return dispatch(db, u, j.kind, j.payload, j.project_id)


@app.get("/api/jobs/{id}/events")
def events(id: str, u=USER, db=DB):
    get_job(db, u, id)

    async def gen():
        previous = ""
        for _ in range(600):
            with SessionLocal() as s:
                j = s.get(Job, id)
                value = json.dumps(job_payload_with_events(s, j), ensure_ascii=False)
                if value != previous:
                    yield "data: " + value + "\n\n"
                    previous = value
                if j.status in ("succeeded", "failed", "cancelled"):
                    break
            await asyncio.sleep(1)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/jobs/{id}/adopt")
def adopt(id: str, u=USER, db=DB):
    j = get_job(db, u, id)
    db.refresh(j, with_for_update=True)
    if j.status != "succeeded" or j.kind not in ("ai", "html_import"):
        raise HTTPException(422, "任务没有可采用的页面")
    if j.result.get("adopted"):
        raise HTTPException(409, "结果已采用")
    bk = booklet_access(db, u, j.payload["booklet_id"], True)
    db.refresh(bk, with_for_update=True)
    docs = j.result.get("documents", [])
    if not docs:
        raise HTTPException(422, "结果为空")
    for d in docs:
        if any(x.get("severity") == "error" for x in d.get("diagnostics", [])):
            raise HTTPException(422, "结果有未解决的转换问题")
    if j.payload.get("page_id"):
        p = db.get(Page, j.payload["page_id"])
        db.refresh(p, with_for_update=True)
        if p.deleted or p.current_revision_id != j.payload["base_revision_id"]:
            raise HTTPException(409, "原页面已有修改，不能覆盖；请基于最新版本重新生成")
        r = Revision(
            page_id=p.id,
            document=docs[0],
            actor_id=u.id,
            source="ai",
            base_revision_id=p.current_revision_id,
        )
        db.add(r)
        db.flush()
        p.current_revision_id = r.id
        bk.version += 1
    else:
        for i, d in enumerate(docs):
            add_page(
                db,
                u,
                bk,
                j.result.get("title", "AI 页面")
                + (" " + str(i + 1) if len(docs) > 1 else ""),
                d,
                j.kind,
            )
    j.result = {**j.result, "adopted": True}
    audit(db, u, "job.adopt", id)
    snapshot_booklet(db, u, bk, "adopt")
    db.commit()
    return booklet_out(db, bk, True)


class ExportIn(BaseModel):
    format: Literal["html", "zip"] = "html"
    draft: bool = False
    booklet_id: str | None = None


@app.post("/api/projects/{id}/exports", status_code=202)
def export(id: str, b: ExportIn, u=USER, db=DB):
    p = project_access(db, u, id, not b.draft)
    bs = list(
        db.scalars(
            select(Booklet).where(Booklet.project_id == id).order_by(Booklet.position)
        )
    )
    if b.booklet_id:
        bk = booklet_access(db, u, b.booklet_id)
        if bk.project_id != id:
            raise HTTPException(422, "分册不匹配")
        bs = [bk]
    elif u.role == "contributor":
        bs = [x for x in bs if x.owner_id == u.id]
    manifest = []
    for bk in bs:
        if b.draft:
            rows = [
                {
                    "page_id": x.id,
                    "revision_id": x.current_revision_id,
                    "title": x.title,
                }
                for x in db.scalars(
                    select(Page)
                    .where(Page.booklet_id == bk.id, Page.deleted == False)
                    .order_by(Page.position)
                )
            ]
        else:
            s = (
                db.get(Submission, bk.latest_submission_id)
                if bk.latest_submission_id
                else None
            )
            if not s or s.status != "approved":
                raise HTTPException(422, "所有分册确认后才能正式合订")
            rows = s.manifest
        manifest.extend(
            [{**x, "booklet_id": bk.id, "booklet_title": bk.title} for x in rows]
        )
    if not manifest:
        raise HTTPException(422, "没有可导出的页面")
    return dispatch(
        db, u, "export", {**b.model_dump(), "manifest": manifest, "title": p.name}, id
    )


@app.get("/api/notifications")
def notifications(u=USER, db=DB):
    return [
        asdict(x)
        for x in db.scalars(
            select(Notification)
            .where(Notification.user_id == u.id)
            .order_by(Notification.created_at.desc())
            .limit(100)
        )
    ]


@app.post("/api/notifications/read")
def read_notifications(u=USER, db=DB):
    for x in db.scalars(select(Notification).where(Notification.user_id == u.id)):
        x.read = True
    db.commit()
    return {"ok": True}


@app.get("/api/dashboard")
def dashboard(u=USER, db=DB):
    ps = projects(u, db)
    return {
        "projects": ps,
        "templates": db.scalar(
            select(func.count())
            .select_from(Template)
            .where(Template.status == "published")
        ),
        "categories": db.scalar(
            select(func.count()).select_from(Category).where(Category.active == True)
        ),
        "pending_templates": db.scalar(
            select(func.count()).select_from(Template).where(Template.status == "draft")
        ),
        "model_configured": bool(db.scalar(select(ModelProfile.id).where(ModelProfile.enabled == True).limit(1))),
    }


@app.get("/api/audit-events")
def audit_events(u=USER, db=DB):
    admin(u)
    return [
        asdict(x)
        for x in db.scalars(select(Audit).order_by(Audit.created_at.desc()).limit(100))
    ]


@app.get("/api/page-library")
def library_pages(u=USER, db=DB):
    return [
        {**asdict(x), "document": db.get(Revision, x.revision_id).document}
        for x in db.scalars(
            select(LibraryPage)
            .where(LibraryPage.owner_id == u.id)
            .order_by(LibraryPage.created_at.desc())
        )
    ]


@app.post("/api/pages/{id}/library")
def save_to_library(id: str, u=USER, db=DB):
    p = db.get(Page, id)
    if not p or p.deleted:
        raise HTTPException(404, "页面不存在")
    booklet_access(db, u, p.booklet_id, True)
    l = LibraryPage(owner_id=u.id, title=p.title, revision_id=p.current_revision_id)
    db.add(l)
    db.flush()
    audit(db, u, "library.save", l.id)
    db.commit()
    return asdict(l)


@app.post("/api/booklets/{id}/library/{library_id}")
def import_library(id: str, library_id: str, u=USER, db=DB):
    b = booklet_access(db, u, id, True)
    db.refresh(b, with_for_update=True)
    l = db.get(LibraryPage, library_id)
    if not l or l.owner_id != u.id:
        raise HTTPException(404, "页面资产不存在")
    p = add_page(db, u, b, l.title, db.get(Revision, l.revision_id).document, "library")
    snapshot_booklet(db, u, b, "library_import")
    db.commit()
    return page_out(db, p)


@app.get("/api/booklets/{id}/history")
def booklet_history(id: str, u=USER, db=DB):
    booklet_access(db, u, id)
    return [
        asdict(x)
        for x in db.scalars(
            select(BookletSnapshot)
            .where(BookletSnapshot.booklet_id == id)
            .order_by(BookletSnapshot.created_at.desc())
            .limit(100)
        )
    ]
