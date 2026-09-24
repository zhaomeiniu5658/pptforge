import os
from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import (
    create_engine,
    String,
    Text,
    DateTime,
    ForeignKey,
    Integer,
    Boolean,
    JSON,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from .settings import database_url, SCHEMA

DATABASE_URL = database_url()
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    connect_args={
        "options": f"-csearch_path={SCHEMA},pg_catalog",
        "connect_timeout": 10,
    },
)
SessionLocal = sessionmaker(engine, expire_on_commit=False)
J = JSON().with_variant(JSONB, "postgresql")


def now():
    return datetime.now(timezone.utc)


def uid():
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class Row:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Department(Row, Base):
    __tablename__ = "departments"
    name: Mapped[str] = mapped_column(String(160), unique=True)
    parent_id: Mapped[str | None] = mapped_column(
        ForeignKey("departments.id"), nullable=True
    )


class User(Row, Base):
    __tablename__ = "users"
    username: Mapped[str] = mapped_column(String(100), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(30), default="contributor")
    department_id: Mapped[str | None] = mapped_column(
        ForeignKey("departments.id"), nullable=True
    )
    employee_no: Mapped[str] = mapped_column(String(80), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class LoginSession(Row, Base):
    __tablename__ = "sessions"
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Category(Row, Base):
    __tablename__ = "template_categories"
    name: Mapped[str] = mapped_column(String(100), unique=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    position: Mapped[int] = mapped_column(Integer, default=0)


class Project(Row, Base):
    __tablename__ = "projects"
    name: Mapped[str] = mapped_column(String(200))
    code: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    field: Mapped[str] = mapped_column(String(80), default="医学")
    project_type: Mapped[str] = mapped_column(String(160), default="", server_default="")
    bid_date: Mapped[str] = mapped_column(String(10), default="", server_default="")
    start_date: Mapped[str] = mapped_column(String(10), default="", server_default="")
    leader_phone: Mapped[str] = mapped_column(String(80), default="", server_default="")
    leader_email: Mapped[str] = mapped_column(String(254), default="", server_default="")
    business_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    leader_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    deadline: Mapped[str] = mapped_column(String(40))
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(30), default="active")


class Member(Row, Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id"),)
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    responsibility: Mapped[str] = mapped_column(Text, default="")


class Booklet(Row, Base):
    __tablename__ = "booklets"
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(200))
    deadline: Mapped[str] = mapped_column(String(40))
    expected_pages: Mapped[int] = mapped_column(Integer, default=4)
    instructions: Mapped[str] = mapped_column(Text, default="")
    position: Mapped[int] = mapped_column(Integer, default=0)
    version: Mapped[int] = mapped_column(Integer, default=1)
    latest_submission_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class Page(Row, Base):
    __tablename__ = "pages"
    booklet_id: Mapped[str] = mapped_column(ForeignKey("booklets.id"))
    title: Mapped[str] = mapped_column(String(200))
    position: Mapped[int] = mapped_column(Integer, default=0)
    current_revision_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    template_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class Revision(Row, Base):
    __tablename__ = "page_revisions"
    page_id: Mapped[str] = mapped_column(ForeignKey("pages.id"))
    document: Mapped[dict] = mapped_column(J)
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    source: Mapped[str] = mapped_column(String(30), default="manual")
    base_revision_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class Submission(Row, Base):
    __tablename__ = "submissions"
    booklet_id: Mapped[str] = mapped_column(ForeignKey("booklets.id"))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    manifest: Mapped[list] = mapped_column(J)
    status: Mapped[str] = mapped_column(String(30), default="submitted")
    review_comment: Mapped[str] = mapped_column(Text, default="")
    reviewer_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Template(Row, Base):
    __tablename__ = "templates"
    name: Mapped[str] = mapped_column(String(200))
    category_id: Mapped[str] = mapped_column(ForeignKey("template_categories.id"))
    department_id: Mapped[str | None] = mapped_column(
        ForeignKey("departments.id"), nullable=True
    )
    shared: Mapped[bool] = mapped_column(Boolean, default=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(30), default="draft")
    current_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class TemplateVersion(Row, Base):
    __tablename__ = "template_versions"
    template_id: Mapped[str] = mapped_column(ForeignKey("templates.id"))
    documents: Mapped[list] = mapped_column(J)
    diagnostics: Mapped[list] = mapped_column(J, default=list)
    source_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    published: Mapped[bool] = mapped_column(Boolean, default=False)


class Asset(Row, Base):
    __tablename__ = "assets"
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    project_id: Mapped[str | None] = mapped_column(
        ForeignKey("projects.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(240))
    media_type: Mapped[str] = mapped_column(String(120))
    path: Mapped[str] = mapped_column(Text)
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))


class Job(Row, Base):
    __tablename__ = "jobs"
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    project_id: Mapped[str | None] = mapped_column(
        ForeignKey("projects.id"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(30), default="queued")
    stage: Mapped[str] = mapped_column(String(100), default="等待处理")
    payload: Mapped[dict] = mapped_column(J, default=dict)
    result: Mapped[dict] = mapped_column(J, default=dict)
    error: Mapped[str] = mapped_column(Text, default="")
    cancelled: Mapped[bool] = mapped_column(Boolean, default=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class JobEvent(Row, Base):
    __tablename__ = "job_events"
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id"))
    data: Mapped[dict] = mapped_column(J)


class Export(Row, Base):
    __tablename__ = "exports"
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id"))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    manifest: Mapped[list] = mapped_column(J)
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id"))
    draft: Mapped[bool] = mapped_column(Boolean, default=True)


class Notification(Row, Base):
    __tablename__ = "notifications"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    message: Mapped[str] = mapped_column(Text)
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False)


class Audit(Row, Base):
    __tablename__ = "audit_events"
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[str] = mapped_column(String(36))
    details: Mapped[dict] = mapped_column(J, default=dict)


class PlatformSetting(Row, Base):
    __tablename__ = "platform_settings"
    key: Mapped[str] = mapped_column(String(80), unique=True)
    value: Mapped[dict] = mapped_column(J, default=dict)


def asdict(row):
    out = {
        c.name: getattr(row, c.name)
        for c in row.__table__.columns
        if c.name not in ("password_hash", "token_hash", "path", "encrypted_key")
    }
    return {k: v.isoformat() if isinstance(v, datetime) else v for k, v in out.items()}


class LibraryPage(Row, Base):
    __tablename__ = "library_pages"
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(200))
    revision_id: Mapped[str] = mapped_column(ForeignKey("page_revisions.id"))


class BookletSnapshot(Row, Base):
    __tablename__ = "booklet_snapshots"
    booklet_id: Mapped[str] = mapped_column(ForeignKey("booklets.id"))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    version: Mapped[int] = mapped_column(Integer)
    manifest: Mapped[list] = mapped_column(J)
    reason: Mapped[str] = mapped_column(String(40))


class ModelProfile(Row, Base):
    __tablename__ = 'model_profiles'
    name: Mapped[str] = mapped_column(String(120), unique=True)
    provider: Mapped[str] = mapped_column(String(30))
    base_url: Mapped[str] = mapped_column(Text)
    model_name: Mapped[str] = mapped_column(String(200))
    encrypted_key: Mapped[str] = mapped_column(Text, default='')
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    supports_images: Mapped[bool] = mapped_column(Boolean, default=False)
    default_text: Mapped[bool] = mapped_column(Boolean, default=False)
    default_image: Mapped[bool] = mapped_column(Boolean, default=False)
