"""Integration tests against the real PostgreSQL/API/queue/render stack.
Run with scripts/test.sh. All mutations use an explicitly labelled QA project.
"""

import os, time, uuid, io, zipfile
import httpx, pytest
from sqlalchemy import select
from quark.db import SessionLocal, Job, Revision, Submission, Page

BASE = os.getenv("TEST_API_BASE_URL", "http://127.0.0.1:8011/api")


@pytest.fixture(scope="module")
def clients():
    out = {}
    for name in ("admin", "bd", "writer", "stat"):
        c = httpx.Client(base_url=BASE, timeout=40, trust_env=False)
        r = c.post(
            "/auth/login",
            json={"username": name, "password": os.environ["BOOTSTRAP_ADMIN_PASSWORD"]},
        )
        assert r.status_code == 200, r.text
        out[name] = c
    yield out
    for c in out.values():
        c.close()


@pytest.fixture(scope="module")
def workspace(clients):
    us = {u["username"]: u for u in clients["bd"].get("/users").json()}
    p = (
        clients["bd"]
        .post(
            "/projects",
            json={
                "name": "QA 集成验证 " + uuid.uuid4().hex[:6],
                "description": "自动化验证数据",
                "deadline": "2027-01-01T00:00:00Z",
                "leader_id": us["writer"]["id"],
                "assignments": [
                    {"user_id": us["writer"]["id"], "title": "医学验证分册"}
                ],
            },
        )
        .json()
    )
    return p, p["booklets"][0], us


def wait_job(c, id):
    for _ in range(80):
        j = c.get("/jobs/" + id).json()
        if j["status"] in ("succeeded", "failed", "cancelled"):
            return j
        time.sleep(0.25)
    pytest.fail("job timeout")


def test_project_basic_information_persists(clients):
    bd = clients["bd"]
    people = {u["username"]: u for u in bd.get("/users").json()}
    body = {
        "name": "QA 项目基本信息 " + uuid.uuid4().hex[:6],
        "project_type": "创新药临床研究项目方案（Phase I - III）",
        "bid_date": "2026-10-22",
        "leader_id": people["bd"]["id"],
        "leader_phone": "13800000000",
        "leader_email": "qa@example.com",
        "description": "验证新建项目基本信息持久化",
        "assignments": [{"user_id": people["writer"]["id"], "title": "医学专业分册", "instructions": "编写研究背景"}],
    }
    for invalid in (
        {"bid_date": "2026-02-30"},
        {"leader_email": "invalid-email"},
    ):
        assert bd.post("/projects", json={**body, **invalid}).status_code == 422
    response = bd.post("/projects", json=body)
    assert response.status_code == 200, response.text
    project = response.json()
    try:
        saved = bd.get("/projects/" + project["id"]).json()
        for key in ("project_type", "bid_date", "leader_id", "leader_phone", "leader_email", "description"):
            assert saved[key] == body[key]
        assert saved["deadline"].startswith("2026-10-22")
        update = {
            "name": body["name"] + " 已编辑",
            "project_type": "临床科研",
            "bid_date": "2026-11-10",
            "leader_id": people["bd"]["id"],
            "leader_phone": "13900000000",
            "leader_email": "updated@example.com",
            "description": "已编辑项目基本信息",
        }
        edited = bd.put("/projects/" + project["id"], json=update)
        assert edited.status_code == 200, edited.text
        saved = bd.get("/projects/" + project["id"]).json()
        for key in ("name", "project_type", "bid_date", "leader_id", "leader_phone", "leader_email", "description"):
            assert saved[key] == update[key]
        assert saved["deadline"].startswith("2026-11-10")
        assert saved["booklets"][0]["deadline"].startswith("2026-11-10")
        assert saved["code"].startswith("QM-")
        assert saved["booklets"][0]["expected_pages"] == 4
        assert saved["booklets"][0]["instructions"] == "编写研究背景"
        assert any(m["user_id"] == people["bd"]["id"] for m in saved["members"])
    finally:
        assert bd.delete("/projects/" + project["id"]).status_code == 200


def test_role_and_scope_guards(clients, workspace):
    p, b, u = workspace
    assert clients["stat"].get("/projects/" + p["id"]).status_code == 403
    assert (
        clients["bd"]
        .post(
            "/booklets/" + b["id"] + "/pages", json={"document": {"html": "<h1>x</h1>"}}
        )
        .status_code
        == 403
    )
    assert (
        clients["writer"]
        .post("/template-categories", json={"name": "forbidden"})
        .status_code
        == 403
    )
    assert (
        clients["writer"]
        .post(
            "/projects",
            json={
                "name": "forbidden",
                "deadline": "2027-01-01",
                "leader_id": u["writer"]["id"],
                "assignments": [{"user_id": u["writer"]["id"], "title": "x"}],
            },
        )
        .status_code
        == 403
    )
    assert (
        clients["admin"]
        .post(
            "/projects",
            json={
                "name": "admin cannot be BD",
                "deadline": "2027-01-01",
                "leader_id": u["writer"]["id"],
                "assignments": [{"user_id": u["writer"]["id"], "title": "x"}],
            },
        )
        .status_code
        == 403
    )


def test_contributors_are_scoped_to_assigned_booklets(clients, workspace):
    """Project membership must not expose another contributor's working pages."""
    _, _, users = workspace
    scoped = clients["bd"].post(
        "/projects",
        json={
            "name": "QA 分册隔离 " + uuid.uuid4().hex[:6],
            "description": "权限隔离回归数据",
            "deadline": "2027-01-01T00:00:00Z",
            "leader_id": users["writer"]["id"],
            "assignments": [
                {"user_id": users["writer"]["id"], "title": "研发分册"},
                {"user_id": users["stat"]["id"], "title": "数统分册"},
            ],
        },
    )
    assert scoped.status_code == 200, scoped.text
    project = scoped.json()
    writer_booklet = next(
        b for b in project["booklets"] if b["owner_id"] == users["writer"]["id"]
    )
    stat_booklet = next(
        b for b in project["booklets"] if b["owner_id"] == users["stat"]["id"]
    )
    for role, own, other in (
        ("writer", writer_booklet, stat_booklet),
        ("stat", stat_booklet, writer_booklet),
    ):
        visible = clients[role].get("/projects/" + project["id"])
        assert visible.status_code == 200, visible.text
        assert [b["id"] for b in visible.json()["booklets"]] == [own["id"]]
        assert clients[role].get("/booklets/" + own["id"]).status_code == 200
        assert clients[role].get("/booklets/" + other["id"]).status_code == 403


def test_revision_conflict_and_frozen_confirmation(clients, workspace):
    p, b, u = workspace
    c = clients["writer"]
    bd = clients["bd"]
    r = c.post(
        "/booklets/" + b["id"] + "/pages",
        json={
            "title": "原始页面",
            "document": {
                "html": '<h1 id="title">确认内容</h1><p>未更改内容</p>',
                "css": "h1{color:#2563eb}",
            },
        },
    )
    assert r.status_code == 200, r.text
    page = r.json()
    workspace[1]["test_page"] = page
    s = c.post("/booklets/" + b["id"] + "/submissions", json={}).json()
    assert s["status"] == "approved"
    assert (
        c.post(
            "/submissions/" + s["id"] + "/review", json={"decision": "approved"}
        ).status_code
        == 403
    )
    assert (
        bd.post(
            "/projects/" + p["id"] + "/exports", json={"format": "html", "draft": False}
        ).status_code
        == 202
    )
    assert (
        bd.post(
            "/submissions/" + s["id"] + "/review",
            json={"decision": "returned", "comment": ""},
        ).status_code
        == 409
    )
    assert (
        bd.post(
            "/submissions/" + s["id"] + "/review",
            json={"decision": "approved", "comment": "核对完成"},
        ).status_code
        == 409
    )
    data = {
        "title": "新草稿",
        "base_revision_id": page["current_revision_id"],
        "document": {"html": "<h1>仅存在于新草稿</h1>"},
    }
    updated = c.post("/pages/" + page["id"] + "/revisions", json=data)
    assert updated.status_code == 200, updated.text
    assert c.post("/pages/" + page["id"] + "/revisions", json=data).status_code == 409
    frozen = bd.get("/submissions/" + s["id"]).json()
    assert "确认内容" in frozen["pages"][0]["document"]["html"]
    assert "仅存在于新草稿" not in frozen["pages"][0]["document"]["html"]
    b["test_page"] = updated.json()
    b["submission_id"] = s["id"]
    assert c.get("/booklets/" + b["id"]).json()["has_new_draft"] is True


def test_official_export_uses_approved_snapshot(clients, workspace):
    p, b, u = workspace
    bd = clients["bd"]
    for fmt in ("html", "zip"):
        r = bd.post(
            "/projects/" + p["id"] + "/exports", json={"format": fmt, "draft": False}
        )
        assert r.status_code == 202, r.text
        j = wait_job(bd, r.json()["id"])
        assert j["status"] == "succeeded", j
        data = bd.get("/assets/" + j["result"]["asset_id"]).content
        if fmt == "zip":
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                assert "manifest.json" in z.namelist()
                data = z.read("index.html")
        text = data.decode()
        assert "确认内容" in text
        assert "仅存在于新草稿" not in text
        assert "<iframe" not in text
        from pathlib import Path

        Path("artifacts/verified-export.html").write_text(text)


def test_template_copy_library_and_order(clients, workspace):
    p, b, u = workspace
    c = clients["writer"]
    t = c.get("/templates").json()[0]
    r = c.post("/booklets/" + b["id"] + "/templates", json={"template_ids": [t["id"]]})
    assert r.status_code == 200, r.text
    book = r.json()
    assert len(book["pages"]) > 1
    page = book["pages"][-1]
    assert page["template_version_id"] == t["current_version_id"]
    lib = c.post("/pages/" + page["id"] + "/library", json={})
    assert lib.status_code == 200
    copied = c.post("/booklets/" + b["id"] + "/library/" + lib.json()["id"], json={})
    assert copied.status_code == 200
    assert copied.json()["id"] != page["id"]
    book = c.get("/booklets/" + b["id"]).json()
    ids = [x["id"] for x in book["pages"]][::-1]
    assert (
        c.put(
            "/booklets/" + b["id"] + "/pages/order",
            json={"ids": ids, "version": book["version"] - 1},
        ).status_code
        == 409
    )
    assert (
        c.put(
            "/booklets/" + b["id"] + "/pages/order",
            json={"ids": ids, "version": book["version"]},
        ).status_code
        == 200
    )
    assert [x["id"] for x in c.get("/booklets/" + b["id"]).json()["pages"]] == ids


def test_template_delete_preserves_copies_and_submission(clients, workspace):
    from quark.db import Template, TemplateVersion, Audit
    from quark.seed import document

    admin = clients["admin"]
    writer = clients["writer"]
    _, booklet, _ = workspace
    category = admin.get("/template-categories").json()[0]
    with SessionLocal() as db:
        template = Template(name="QA 删除模板 " + uuid.uuid4().hex[:6],
                            category_id=category["id"], status="published")
        db.add(template)
        db.flush()
        version = TemplateVersion(template_id=template.id,
                                  documents=[document("删除后保留页面")], published=True)
        db.add(version)
        db.flush()
        template.current_version_id = version.id
        tid, vid = template.id, version.id
        db.commit()
    url = "/templates/" + tid
    for role in ("bd", "writer", "stat"):
        assert clients[role].delete(url).status_code == 403
    imported = writer.post("/booklets/" + booklet["id"] + "/templates",
                           json={"template_ids": [tid]})
    assert imported.status_code == 200, imported.text
    copied = next(p for p in imported.json()["pages"] if p["template_version_id"] == vid)
    submitted = writer.post("/booklets/" + booklet["id"] + "/submissions", json={})
    assert submitted.status_code == 200, submitted.text
    submission_url = "/submissions/" + submitted.json()["id"]
    frozen = writer.get(submission_url).json()
    assert admin.delete(url).status_code == 200
    for client in (admin, writer):
        assert tid not in [t["id"] for t in client.get("/templates").json()]
    assert next(c for c in admin.get("/template-categories").json()
                if c["id"] == category["id"])["count"] == category["count"]
    assert writer.post("/booklets/" + booklet["id"] + "/templates",
                       json={"template_ids": [tid]}).status_code == 403
    assert admin.patch(url, json={"active": True}).status_code == 404
    assert admin.post(url + "/publish", json={}).status_code == 404
    assert admin.delete(url).status_code == 404
    assert writer.get(submission_url).json() == frozen
    pages = writer.get("/booklets/" + booklet["id"]).json()["pages"]
    assert next(p for p in pages if p["id"] == copied["id"]) == copied
    with SessionLocal() as db:
        assert db.get(TemplateVersion, vid) is not None
        assert db.scalar(select(Audit).where(Audit.entity_id == tid,
                                             Audit.action == "template.delete")) is not None


def test_admin_can_edit_template_metadata_and_content(clients):
    from quark.db import Category, Department, Template, TemplateVersion
    admin = clients["admin"]
    with SessionLocal() as db:
        category = db.scalar(select(Category).where(Category.active == True))
        department = db.scalar(select(Department))
        template = Template(name="QA 模板编辑 " + uuid.uuid4().hex[:6], category_id=category.id,
                            department_id=department.id, shared=True, status="published")
        db.add(template)
        db.flush()
        version = TemplateVersion(template_id=template.id, documents=[{"html": "<h1>旧标题</h1>", "css": "h1{color:red}"}], published=True)
        db.add(version)
        db.flush()
        template.current_version_id = version.id
        db.commit()
        tid, old_version = template.id, version.id
    try:
        categories = admin.get("/template-categories").json()
        department_id = next(d["id"] for d in admin.get("/departments").json())
        info = admin.patch("/templates/" + tid, json={"name": "QA 模板编辑已改", "category_id": categories[-1]["id"], "department_id": department_id, "shared": False})
        assert info.status_code == 200, info.text
        updated = admin.get("/templates").json()
        assert next(x for x in updated if x["id"] == tid)["name"] == "QA 模板编辑已改"
        for role in ("bd", "writer", "stat"):
            assert clients[role].patch("/templates/" + tid, json={"name": "forbidden"}).status_code == 403
            assert clients[role].patch("/templates/" + tid + "/content", json={"base_version_id": old_version, "documents": [{"html": "<p>x</p>"}]}).status_code == 403
        assert admin.patch("/templates/" + tid, json={"name": "  "}).status_code == 422
        assert admin.patch("/templates/" + tid, json={"category_id": ""}).status_code == 422
        assert admin.patch("/templates/" + tid, json={"department_id": "missing"}).status_code == 422
        cleared = admin.patch("/templates/" + tid, json={"department_id": None})
        assert cleared.status_code == 200 and cleared.json()["department_id"] is None
        content = admin.patch("/templates/" + tid + "/content", json={
            "base_version_id": old_version,
            "documents": [{"html": "<h1 data-node-id=\"title\">新标题</h1>", "css": "h1{color:#2563eb}"}],
        })
        assert content.status_code == 200, content.text
        assert content.json()["status"] == "draft"
        assert content.json()["documents"][0]["html"].find("新标题") >= 0
        stale = admin.patch("/templates/" + tid + "/content", json={
            "base_version_id": old_version,
            "documents": [{"html": "<h1>冲突</h1>"}],
        })
        assert stale.status_code == 409
        assert admin.patch("/templates/" + tid + "/content", json={"base_version_id": None, "documents": [{"html": "<p>stale</p>"}]}).status_code == 409
        with SessionLocal() as db:
            original = db.get(TemplateVersion, old_version)
            assert original.documents[0]["html"] == "<h1>旧标题</h1>"
            assert original.published is True
        assert admin.post("/templates/" + tid + "/publish", json={}).status_code == 200
    finally:
        assert admin.delete("/templates/" + tid).status_code == 200


def test_html_import_candidate_does_not_overwrite(clients, workspace):
    p, b, u = workspace
    c = clients["writer"]
    before = c.get("/booklets/" + b["id"]).json()
    r = c.post(
        "/assets",
        files={"file": ("import.html", "<h1>独立导入候选</h1>", "text/html")},
        data={"project_id": p["id"]},
    )
    assert r.status_code == 200
    j = c.post(
        "/imports", json={"asset_id": r.json()["id"], "booklet_id": b["id"]}
    ).json()
    j = wait_job(c, j["id"])
    assert j["status"] == "succeeded", j
    assert c.get("/booklets/" + b["id"]).json()["page_count"] == before["page_count"]
    assert c.post("/jobs/" + j["id"] + "/adopt", json={}).status_code == 200
    assert c.post("/jobs/" + j["id"] + "/adopt", json={}).status_code == 409
    assert (
        c.get("/booklets/" + b["id"]).json()["page_count"] == before["page_count"] + 1
    )


def test_ai_adoption_rechecks_base_revision(clients, workspace):
    p, b, u = workspace
    c = clients["writer"]
    page = b["test_page"]
    with SessionLocal() as db:
        # A deterministic worker result fixture tests adoption, without pretending to call a model.
        j = Job(
            owner_id=u["writer"]["id"],
            project_id=p["id"],
            kind="ai",
            status="succeeded",
            payload={
                "booklet_id": b["id"],
                "page_id": page["id"],
                "base_revision_id": "obsolete",
            },
            result={"documents": [{"html": "<h1>must not overwrite</h1>", "css": ""}]},
        )
        db.add(j)
        db.commit()
        jid = j.id
    assert c.post("/jobs/" + jid + "/adopt", json={}).status_code == 409
    current = c.get("/booklets/" + b["id"]).json()
    assert (
        "仅存在于新草稿"
        in next(x for x in current["pages"] if x["id"] == page["id"])["document"][
            "html"
        ]
    )


def test_model_missing_fails_honestly(clients, workspace):
    if os.getenv("MODEL_NAME"):
        pytest.skip(
            "A real model is configured; avoid consuming credentials in this test"
        )
    p, b, u = workspace
    c = clients["writer"]
    j = c.post(
        "/ai/tasks",
        json={"project_id": p["id"], "booklet_id": b["id"], "prompt": "生成页面"},
    ).json()
    j = wait_job(c, j["id"])
    assert j["status"] == "failed"
    assert "尚未配置 AI 模型" in j["error"]
    assert not j["result"]


def test_cancelled_result_cannot_be_adopted(clients, workspace):
    p, b, u = workspace
    c = clients["writer"]
    with SessionLocal() as db:
        j = Job(
            owner_id=u["writer"]["id"],
            project_id=p["id"],
            kind="ai",
            payload={"booklet_id": b["id"]},
        )
        db.add(j)
        db.commit()
        jid = j.id
    assert c.post("/jobs/" + jid + "/cancel", json={}).json()["status"] == "cancelled"
    assert c.post("/jobs/" + jid + "/adopt", json={}).status_code == 422


def test_csrf_origin_guard(clients):
    assert (
        clients["admin"]
        .post(
            "/template-categories",
            json={"name": "evil"},
            headers={"Origin": "https://other.example"},
        )
        .status_code
        == 403
    )


def test_booklet_order_history_is_frozen(clients, workspace):
    _, b, _ = workspace
    snapshots = clients["writer"].get("/booklets/" + b["id"] + "/history").json()
    assert len(snapshots) >= 4
    reorder = next(x for x in snapshots if x["reason"] == "reorder")
    assert reorder["manifest"]
    assert all(x["revision_id"] for x in reorder["manifest"])


def test_worker_retains_best_of_three_candidates(clients, workspace, monkeypatch):
    from quark import tasks
    from quark.content import tool
    import base64

    p, b, u = workspace
    c = clients["writer"]
    reference = tool(
        "/internal/render",
        {
            "document": {"html": "<h1>参考图</h1>", "css": ""},
            "width": 800,
            "height": 600,
        },
    )
    asset = c.post(
        "/assets",
        files={"file": ("target.png", base64.b64decode(reference["png"]), "image/png")},
        data={"project_id": p["id"]},
    ).json()
    outputs = iter(
        ["<h1>最佳首轮候选</h1>", "<h1>第二轮较差</h1>", "<h1>第三轮较差</h1>"]
    )
    scores = iter([0.8, 0.5, 0.6])
    real_tool = tasks.tool
    monkeypatch.setattr(tasks, "generate", lambda *args: next(outputs))

    def controlled_diff(path, payload, *args):
        if path == "/internal/compare":
            return {"score": next(scores), "dimensionMismatch": False}
        return real_tool(path, payload, *args)

    monkeypatch.setattr(tasks, "tool", controlled_diff)
    with SessionLocal() as db:
        j = Job(
            owner_id=u["writer"]["id"],
            project_id=p["id"],
            kind="ai",
            payload={
                "project_id": p["id"],
                "booklet_id": b["id"],
                "prompt": "contract fixture",
                "asset_id": asset["id"],
            },
        )
        db.add(j)
        db.commit()
        jid = j.id
    tasks.execute.run(jid)
    j = c.get("/jobs/" + jid).json()
    assert j["status"] == "succeeded", j
    assert len(j["result"]["rounds"]) == 3
    assert "最佳首轮候选" in j["result"]["documents"][0]["html"]
    assert j["result"]["score"] == 0.8


def test_cancellation_during_model_call_cannot_finish_successfully(
    clients, workspace, monkeypatch
):
    from quark import tasks
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event

    p, b, u = workspace
    c = clients["writer"]
    entered = Event()
    release = Event()

    def blocked_model(*args):
        entered.set()
        assert release.wait(5)
        return "<h1>不得采用</h1>"

    monkeypatch.setattr(tasks, "generate", blocked_model)
    with SessionLocal() as db:
        j = Job(
            owner_id=u["writer"]["id"],
            project_id=p["id"],
            kind="ai",
            payload={
                "project_id": p["id"],
                "booklet_id": b["id"],
                "prompt": "cancel fixture",
            },
        )
        db.add(j)
        db.commit()
        jid = j.id
    with ThreadPoolExecutor(max_workers=1) as executor:
        f = executor.submit(tasks.execute.run, jid)
        assert entered.wait(5)
        assert c.post("/jobs/" + jid + "/cancel", json={}).status_code == 200
        release.set()
        f.result(timeout=10)
    j = c.get("/jobs/" + jid).json()
    assert j["status"] == "cancelled"
    assert c.post("/jobs/" + jid + "/adopt", json={}).status_code == 422


def test_worker_can_resume_persisted_job_idempotently(clients, workspace):
    from quark import tasks

    p, b, u = workspace
    c = clients["writer"]
    a = c.post(
        "/assets",
        files={"file": ("recover.html", "<h1>恢复候选</h1>", "text/html")},
        data={"project_id": p["id"]},
    ).json()
    with SessionLocal() as db:
        j = Job(
            owner_id=u["writer"]["id"],
            project_id=p["id"],
            kind="html_import",
            status="running",
            attempts=1,
            payload={"booklet_id": b["id"], "asset_id": a["id"]},
        )
        db.add(j)
        db.commit()
        jid = j.id
    tasks.execute.run(jid)
    first = c.get("/jobs/" + jid).json()
    assert first["status"] == "succeeded"
    assert first["attempts"] == 2
    tasks.execute.run(jid)
    second = c.get("/jobs/" + jid).json()
    assert second["attempts"] == 2
    assert second["result"] == first["result"]


def test_template_folder_and_zip_import(clients):
    admin = clients['admin']
    category = next(c for c in admin.get('/template-categories').json() if c['active'])
    files = [
        ('files', ('demo/pages/code.html', b'<link rel="stylesheet" href="../theme.css"><h1>Folder template</h1>', 'text/html')),
        ('files', ('demo/theme.css', b'h1{color:#123456}', 'text/css')),
    ]
    form = {'category_id': category['id'], 'input_mode': 'folder', 'template_name': 'QA 文件夹入库'}
    assert clients['writer'].post('/templates/imports', files=files, data=form).status_code == 403
    bad = admin.post('/templates/imports', files=[('files', ('../escape.html', b'<p>x</p>', 'text/html'))], data=form)
    assert bad.status_code == 422
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('nested/code.html', '<h1>ZIP template</h1>')
        z.writestr('nested/screen.png', b'not-used-as-html')
    for upload, fields in [
        (files, form),
        ([('files', ('export.zip', buf.getvalue(), 'application/zip'))], {'category_id': category['id']}),
    ]:
        response = admin.post('/templates/imports', files=upload, data=fields)
        assert response.status_code == 202, response.text
        job = wait_job(admin, response.json()[0]['id'])
        assert job['status'] == 'succeeded', job.get('error')
        template_id = job['result']['template_id']
        try:
            template = next(t for t in admin.get('/templates').json() if t['id'] == template_id)
            assert len(template['documents']) == 1
            assert template['status'] == 'draft'
            assert not template['diagnostics']
            if fields.get('input_mode') == 'folder':
                assert template['name'] == 'QA 文件夹入库'
                assert '#123456' in template['documents'][0]['css']
            assert admin.post('/templates/' + template_id + '/publish', json={}).status_code == 200
        finally:
            assert admin.delete('/templates/' + template_id).status_code == 200
    before = {j['id'] for j in admin.get('/jobs').json()}
    response = admin.post('/templates/imports', files=[
        ('files', ('ok.html', b'<h1>valid</h1>', 'text/html')),
        ('files', ('bad.zip', b'not a zip', 'application/zip')),
    ], data={'category_id': category['id']})
    assert response.status_code == 422
    assert {j['id'] for j in admin.get('/jobs').json()} == before
