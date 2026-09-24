"""Remote PostgreSQL is required. No implicit local database fallback."""

import os, re
from sqlalchemy.engine import URL, make_url


def database_url():
    url = os.getenv("DATABASE_URL", "").strip()
    if url:
        parsed = make_url(url)
        if parsed.drivername in ("postgres", "postgresql"):
            parsed = parsed.set(drivername="postgresql+psycopg")
        if parsed.drivername != "postgresql+psycopg":
            raise RuntimeError("本平台仅支持 PostgreSQL / psycopg")
        return parsed
    host = os.getenv("PGHOST", "").strip()
    if not host:
        raise RuntimeError(
            "尚未配置远程 PostgreSQL。请设置 .env 的 PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD 或 DATABASE_URL。"
        )
    query = {"sslmode": os.getenv("PGSSLMODE", "require"), "connect_timeout": "10"}
    if os.getenv("PGSSLROOTCERT"):
        query["sslrootcert"] = os.environ["PGSSLROOTCERT"]
    return URL.create(
        "postgresql+psycopg",
        username=os.getenv("PGUSER"),
        password=os.getenv("PGPASSWORD"),
        host=host,
        port=int(os.getenv("PGPORT", "5432")),
        database=os.getenv("PGDATABASE"),
        query=query,
    )


SCHEMA = os.getenv("DATABASE_SCHEMA", "quarkmed")
if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", SCHEMA):
    raise RuntimeError("DATABASE_SCHEMA 仅允许小写字母、数字和下划线")
