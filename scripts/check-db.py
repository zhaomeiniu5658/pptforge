"""Read-only remote connection preflight. Never creates tables or exposes passwords."""

from sqlalchemy import create_engine, text
from quark.settings import database_url, SCHEMA

engine = create_engine(database_url(), connect_args={"connect_timeout": 10})
with engine.connect() as c:
    r = c.execute(text("SELECT current_database(),current_user,version()")).one()
    exists = c.execute(
        text(
            "SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name=:s)"
        ),
        {"s": SCHEMA},
    ).scalar()
    print("Connected:", r[0], "/ user:", r[1])
    print("PostgreSQL:", r[2].split(" on ")[0])
    print("Platform schema:", SCHEMA, "(exists)" if exists else "(not created yet)")
