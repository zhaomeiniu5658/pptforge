"""pg_dump remote platform schema; password travels via environment, not argv."""

import os, sys, subprocess, shutil
from quark.settings import database_url, SCHEMA

url = database_url()
env = os.environ.copy()
for key, val in {
    "PGHOST": url.host,
    "PGPORT": str(url.port or 5432),
    "PGDATABASE": url.database,
    "PGUSER": url.username,
    "PGPASSWORD": url.password,
    "PGSSLMODE": url.query.get("sslmode", os.getenv("PGSSLMODE", "require")),
}.items():
    if val is not None:
        env[key] = val
if not shutil.which("pg_dump"):
    raise SystemExit(
        "Install a PostgreSQL client with pg_dump matching the remote major version."
    )
subprocess.run(
    ["pg_dump", "--format=custom", "--schema=" + SCHEMA, "--file=" + sys.argv[1]],
    env=env,
    check=True,
)
