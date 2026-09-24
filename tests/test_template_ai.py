"""Template AI boundaries and worker context; no production writes or model calls."""
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient
from quark import main, tasks
from quark.db import Template, Job, Asset
from quark.security import current_user, db_session


@pytest.fixture
def api(monkeypatch):
    user = NS(id="admin-test", role="admin")
    template = NS(id="template-test", current_version_id="v1", status="draft", name="测试模板")
    records = {(Template, template.id): template}
    db = NS(get=lambda cls, id: records.get((cls, id)))
    main.app.dependency_overrides[current_user] = lambda: user
    main.app.dependency_overrides[db_session] = lambda: db
    monkeypatch.setattr(main, "resolve_model", lambda *a: NS(id="model", name="测试模型"))
    monkeypatch.setattr(main, "dispatch", lambda db, u, kind, payload, pid=None: {"kind": kind, "payload": payload})
    with TestClient(main.app) as client:
        yield client, user, template, records
    main.app.dependency_overrides.clear()


def test_template_generation_requires_admin_and_current_version(api):
    client, user, template, records = api
    body = {"base_version_id": "v1", "prompt": "生成概览"}
    url = "/api/templates/template-test/ai/tasks"
    user.role = "contributor"
    assert client.post(url, json=body).status_code == 403
    user.role = "admin"
    assert client.post(url, json={**body, "base_version_id": "old"}).status_code == 409
    assert client.post(url, json={**body, "mode": "replace"}).status_code == 422
    result = client.post(url, json={**body, "mode": "replace", "document": {"html": "<h1>未保存草稿</h1>"}})
    assert result.status_code == 202
    assert result.json()["kind"] == "template_ai"
    assert "未保存草稿" in result.json()["payload"]["document"]["html"]
    assert template.current_version_id == "v1"
    template.status = "deleted"
    assert client.post(url, json=body).status_code == 404


def test_template_candidate_and_asset_boundaries(api):
    client, user, template, records = api
    url = "/api/templates/template-test/ai/tasks"
    body = {"base_version_id": "v1", "prompt": "继续修改", "parent_job_id": "parent"}
    parent = NS(owner_id=user.id, kind="template_ai", status="succeeded",
                payload={"template_id": template.id, "base_version_id": "v1"})
    records[Job, "parent"] = parent
    assert client.post(url, json=body).status_code == 202
    parent.payload["template_id"] = "other-template"
    assert client.post(url, json=body).status_code == 403
    parent.payload["template_id"] = template.id
    parent.owner_id = "other-user"
    assert client.post(url, json=body).status_code == 403
    records[Asset, "file"] = NS(owner_id=user.id, media_type="text/html")
    assert client.post(url, json={**body, "parent_job_id": None, "asset_id": "file"}).status_code == 422


def test_template_worker_uses_draft_without_booklet_or_publishing(monkeypatch):
    observed = []
    document = {"html": "<h1>修改结果</h1>"}
    job = NS(kind="template_ai", payload={"template_name": "医学模板", "prompt": "调整颜色",
        "document": {"html": "<p>草稿医学文字</p>"}, "model_id": "selected"}, result={})
    from quark import model_profiles
    monkeypatch.setattr(model_profiles, "load_model", lambda *a: {"name": "configured"})
    def generate(prompt, images, *, config):
        observed.append((prompt, config))
        return document["html"]
    monkeypatch.setattr(tasks, "generate", generate)
    monkeypatch.setattr(tasks, "normalize", lambda d: d)
    monkeypatch.setattr(tasks, "stage", lambda *a: None)
    monkeypatch.setattr(tasks, "tool", lambda *a: {"png": "", "metrics": {}, "errors": []})
    result = tasks.ai(NS(commit=lambda: None), job)
    assert result["documents"] == [document]
    assert result["adopted"] is False
    assert "草稿医学文字" in observed[0][0]
    assert "医学模板" in observed[0][0]
    assert observed[0][1] == {"name": "configured"}
