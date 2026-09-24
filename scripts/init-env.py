#!/usr/bin/env python3
"""Generate local secrets once. Never overwrite an existing deployment."""

from pathlib import Path
import secrets

root = Path(__file__).resolve().parents[1]
path = root / ".env"
if path.exists():
    print(".env already exists; left unchanged.")
else:
    text = (root / ".env.example").read_text()
    text = text.replace(
        "TOOL_SECRET=quark-local-tools-change-me",
        "TOOL_SECRET=" + secrets.token_urlsafe(32),
    )
    text = text.replace(
        "BOOTSTRAP_ADMIN_PASSWORD=",
        "BOOTSTRAP_ADMIN_PASSWORD=" + secrets.token_urlsafe(18),
    )
    path.write_text(text)
    path.chmod(0o600)
    print("Generated .env. Initial administrator password is stored there.")
