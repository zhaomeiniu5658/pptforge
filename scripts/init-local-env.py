"""Choose local PostgreSQL explicitly. Existing database settings remain untouched."""

from pathlib import Path
import secrets, re

p = Path(__file__).resolve().parents[1] / ".env"
if not p.exists():
    raise SystemExit("Run scripts/init-env.py first.")
s = p.read_text()
host = re.search(r"^PGHOST=(.*)$", s, re.M)
if host and host[1].strip().strip("'\""):
    raise SystemExit("A database is already configured; no values changed.")
password = secrets.token_urlsafe(24)
for key, value in {
    "PGHOST": "127.0.0.1",
    "PGPORT": "5441",
    "PGDATABASE": "quarkmed",
    "PGUSER": "quark",
    "PGPASSWORD": password,
    "PGSSLMODE": "disable",
    "DATABASE_SCHEMA": "quarkmed",
    "DOCKER_PGHOST": "db",
    "DOCKER_PGPORT": "5432",
    "LOCAL_POSTGRES_PASSWORD": password,
}.items():
    if re.search("^" + key + "=", s, re.M):
        s = re.sub("^" + key + "=.*$", key + "=" + value, s, flags=re.M)
    else:
        s += "\n" + key + "=" + value + "\n"
p.write_text(s)
p.chmod(0o600)
print("Local PostgreSQL configured; no database started yet.")
