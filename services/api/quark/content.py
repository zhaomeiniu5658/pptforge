import os, json, base64, hashlib, mimetypes
from pathlib import Path
import httpx
from .db import Asset, Audit

ROOT = Path(os.getenv("STORAGE_ROOT", "data/assets")).resolve()
ROOT.mkdir(parents=True, exist_ok=True)


def tool(path, payload, timeout=120):
    with httpx.Client(timeout=timeout, trust_env=False) as c:
        r = c.post(
            os.getenv("TOOL_URL", "http://127.0.0.1:8012") + path,
            json=payload,
            headers={
                "x-tool-secret": os.getenv("TOOL_SECRET", "quark-local-tools-change-me")
            },
        )
        if r.status_code >= 400:
            raise ValueError(r.json().get("error", "文档处理失败"))
        return r.json()


def store_asset(db, user_id, name, data, media_type=None, project_id=None):
    digest = hashlib.sha256(data).hexdigest()
    path = ROOT / digest[:2] / digest
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    a = Asset(
        owner_id=user_id,
        project_id=project_id,
        name=Path(name).name[:240],
        path=str(path),
        media_type=media_type
        or mimetypes.guess_type(name)[0]
        or "application/octet-stream",
        size=len(data),
        sha256=digest,
    )
    db.add(a)
    db.flush()
    return a


def audit(db, user, action, entity, details=None):
    db.add(
        Audit(
            actor_id=user.id if hasattr(user, "id") else user,
            action=action,
            entity_id=entity,
            details=details or {},
        )
    )


def normalize(document):
    return tool("/internal/normalize", {"document": document})["document"]


def asset_data(asset):
    return (
        "data:"
        + asset.media_type
        + ";base64,"
        + base64.b64encode(Path(asset.path).read_bytes()).decode()
    )
