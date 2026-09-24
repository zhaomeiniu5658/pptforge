import pytest
from quark.settings import database_url


def test_missing_remote_configuration_has_no_local_fallback(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("PGHOST", raising=False)
    with pytest.raises(RuntimeError, match="远程 PostgreSQL"):
        database_url()


def test_password_special_characters_and_ssl(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("PGHOST", "pg.internal.example")
    monkeypatch.setenv("PGUSER", "quark")
    monkeypatch.setenv("PGPASSWORD", "a@b:c/$!")
    monkeypatch.setenv("PGDATABASE", "research")
    monkeypatch.setenv("PGSSLMODE", "verify-full")
    u = database_url()
    assert u.host == "pg.internal.example"
    assert u.password == "a@b:c/$!"
    assert u.query["sslmode"] == "verify-full"


def test_standard_postgres_url_is_normalized(monkeypatch):
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://someone:secret@remote.example/project?sslmode=require",
    )
    u = database_url()
    assert u.drivername == "postgresql+psycopg"
    assert u.host == "remote.example"
