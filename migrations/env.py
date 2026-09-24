from alembic import context
from quark.db import engine, Base
from quark.settings import SCHEMA
from sqlalchemy import text

with engine.connect() as connection:
    connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{SCHEMA}"'))
    connection.commit()
    context.configure(
        connection=connection,
        target_metadata=Base.metadata,
        version_table_schema=SCHEMA,
    )
    with context.begin_transaction():
        context.run_migrations()
