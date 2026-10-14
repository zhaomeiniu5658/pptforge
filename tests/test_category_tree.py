"""Isolated category API checks; never modify the business database."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from quark.db import Department, User, Category, Template, Audit, TemplateVersion
from quark.main import app
from quark.security import current_user, db_session
from quark.category_tree import validate_category, descendants


class TestSession(Session):
    __test__ = False
    def execute(self, statement, *args, **kwargs):
        if str(statement) == "SELECT pg_advisory_xact_lock(71340220)":
            return None  # SQLite has one connection; production serializes using PostgreSQL.
        return super().execute(statement, *args, **kwargs)


@pytest.fixture
def setup():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    for model in (Department, User, Category, Template, TemplateVersion, Audit):
        model.__table__.create(engine)
    Factory = sessionmaker(engine, class_=TestSession, expire_on_commit=False)
    with Factory() as db:
        a, b = Department(name="注册"), Department(name="统计")
        db.add_all([a, b]); db.flush()
        admin = User(username="admin", name="管理员", password_hash="unused", role="admin")
        db.add(admin); db.commit()
    def session():
        with Factory() as db:
            yield db
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[db_session] = session
    app.dependency_overrides[current_user] = lambda: admin
    client = TestClient(app)  # No lifespan/startup against the business database.
    try:
        yield client, Factory, a.id, b.id, admin
    finally:
        client.close()
        app.dependency_overrides.clear(); app.dependency_overrides.update(previous)
        engine.dispose()


def add(client, department, name="一级", parent=None):
    r = client.post("/api/template-categories", json={"name": name, "department_id": department, "parent_id": parent})
    assert r.status_code == 200, r.text
    return r.json()


def test_department_names_are_unique_only_within_same_parent(setup):
    c, factory, a, b, user = setup
    root = add(c, a, "其他")
    add(c, b, "其他")
    add(c, None, "其他")
    add(c, a, "其他", root["id"])
    assert c.post("/api/template-categories", json={"name":"其他", "department_id":a}).status_code == 409


def test_same_department_parent_and_two_levels_required(setup):
    c, factory, a, b, user = setup
    root = add(c, a)
    child = add(c, a, "二级", root["id"])
    for department, parent in [(b, root["id"]), (a, child["id"])]:
        assert c.post("/api/template-categories", json={"name":"非法", "department_id":department, "parent_id":parent}).status_code == 422
    assert c.patch("/api/template-categories/"+root["id"], json={"parent_id":root["id"]}).status_code == 422
    assert c.patch("/api/template-categories/"+root["id"], json={"department_id":b}).status_code == 422


def test_parent_disable_cascades_and_patch_preserves_scope(setup):
    c, factory, a, b, user = setup
    root = add(c, a)
    child = add(c, a, "二级", root["id"])
    c.patch("/api/template-categories/"+root["id"], json={"active":False})
    rows = c.get("/api/template-categories").json()
    assert all(not row["active"] for row in rows)
    assert rows[1]["parent_id"] == root["id"] and rows[1]["department_id"] == a
    assert c.patch("/api/template-categories/"+child["id"], json={"active":True}).status_code == 422
    c.patch("/api/template-categories/"+root["id"], json={"active":True})
    rows = c.get("/api/template-categories").json()
    assert not next(row for row in rows if row["id"] == child["id"])["active"]


def test_import_and_move_require_matching_department_and_counts_include_children(setup):
    c, factory, a, b, user = setup
    root = add(c, a)
    child = add(c, a, "二级", root["id"])
    with factory() as db:
        db.add(Template(name="部门模板", category_id=child["id"], department_id=a))
        db.commit()
        assert validate_category(db, child["id"], a)
        with pytest.raises(Exception) as exc:
            validate_category(db, child["id"], b)
        assert exc.value.status_code == 422
        assert descendants(list(db.scalars(select(Category))),root["id"]) == {root["id"],child["id"]}
    assert c.patch("/api/template-categories/"+child["id"],json={"department_id":b,"parent_id":None}).status_code == 422
    rows=c.get("/api/template-categories").json()
    assert next(row for row in rows if row["id"]==root["id"])["subtree_count"] == 1
    assert next(row for row in rows if row["id"]==child["id"])["path"] == "一级 / 二级"
    r=c.post("/api/templates/imports",data={"category_id":child["id"],"department_id":b},files={"files":("test.html",b"<main>test</main>","text/html")})
    assert r.status_code==422


def test_non_admin_cannot_create_and_whitespace_rejected(setup):
    c, factory, a, b, user = setup
    assert c.post("/api/template-categories",json={"name":"  ","department_id":a}).status_code==422
    user.role="contributor"
    assert c.post("/api/template-categories",json={"name":"test","department_id":a}).status_code==403


def test_template_edit_uses_category_scope_and_blocks_manual_override(setup):
    c, factory, a, b, user = setup
    public = add(c, None, "通用")
    own = add(c, a, "部门分类")
    other = add(c, b, "其他部门分类")
    with factory() as db:
        template = Template(name="模板", category_id=public['id'], department_id=None, shared=True)
        db.add(template);db.commit();tid=template.id
    r=c.patch('/api/templates/'+tid,json={'category_id':own['id']})
    assert r.status_code==200,r.text
    with factory() as db:
        t=db.get(Template,tid);assert t.department_id==a and t.shared is False
    assert c.patch('/api/templates/'+tid,json={'category_id':other['id'],'department_id':a}).status_code==422
    assert c.patch('/api/templates/'+tid,json={'shared':True}).status_code==422
    assert c.patch('/api/templates/'+tid,json={'category_id':public['id']}).status_code==200
    with factory() as db:
        t=db.get(Template,tid);assert t.department_id is None and t.shared is True
    user.role='contributor';user.department_id=a
    from quark.main import template_scope_from_category
    with factory() as db:
        with pytest.raises(Exception) as exc:template_scope_from_category(db,user,db.get(Category,other['id']))
        assert exc.value.status_code==403


def test_import_derives_scope_without_department_or_shared_fields(setup, monkeypatch):
    from quark import main
    from types import SimpleNamespace
    c, factory, a, b, user=setup
    category=add(c,a)
    monkeypatch.setattr(main,'store_asset',lambda *args:SimpleNamespace(id='test-asset'))
    monkeypatch.setattr(main,'dispatch',lambda db,u,kind,payload:payload)
    r=c.post('/api/templates/imports',data={'category_id':category['id']},files={'files':('test.html',b'<main>test</main>','text/html')})
    assert r.status_code==202,r.text
    assert r.json()[0]['department_id']==a and r.json()[0]['shared'] is False
    user.role='contributor';user.department_id=b
    assert c.post('/api/templates/imports',data={'category_id':category['id']},files={'files':('test.html',b'<main>test</main>','text/html')}).status_code==403


def test_delete_unused_subtree_and_preserve_linked_history(setup):
    c, factory, a, b, user = setup
    root = add(c, a)
    child = add(c, a, "二级", root["id"])
    with factory() as db:
        template = Template(name="历史模板", category_id=child["id"], department_id=a, status="deleted")
        db.add(template); db.commit()
        template_id = template.id
    assert c.delete("/api/template-categories/" + root["id"]).status_code == 409
    assert len(c.get("/api/template-categories").json()) == 2
    with factory() as db:
        db.delete(db.get(Template, template_id)); db.commit()
    assert c.delete("/api/template-categories/" + root["id"]).json() == {"deleted": 2}
    assert c.get("/api/template-categories").json() == []
    assert c.delete("/api/template-categories/" + root["id"]).status_code == 404


def test_delete_requires_admin(setup):
    c, factory, a, b, user = setup
    root = add(c, a)
    user.role = "contributor"
    assert c.delete("/api/template-categories/" + root["id"]).status_code == 403


def test_department_only_categories_use_authenticated_department(setup):
    c, factory, a, b, user = setup
    own = add(c, a, "本部门分类")
    add(c, b, "其他部门分类")
    add(c, None, "通用分类")
    user.role = "contributor"
    user.department_id = a
    rows = c.get("/api/template-categories?department_only=1").json()
    assert [row["id"] for row in rows] == [own["id"]]
    user.department_id = None
    assert c.get("/api/template-categories?department_only=1").json() == []


def test_department_only_templates_exclude_other_departments_and_public(setup, monkeypatch):
    from quark import main
    c, factory, a, b, user = setup
    category = add(c, a)
    with factory() as db:
        for department in (a, b, None):
            db.add(Template(name=str(department), category_id=category["id"], department_id=department,
                            active=True, shared=True, status="published"))
        db.commit()
    # Isolate department filtering from unrelated rendering/asset output.
    monkeypatch.setattr(main, "template_out", lambda db, t, **kw: {"department_id": t.department_id})
    monkeypatch.setattr(main, "template_visible_to_user", lambda *args: True)
    user.role = "contributor"
    user.department_id = a
    assert c.get("/api/templates?department_only=1").json() == [{"department_id": a}]
    user.department_id = None
    assert c.get("/api/templates?department_only=1").json() == []


def test_drag_moves_up_down_and_subtree_between_departments(setup):
    c, factory, a, b, user = setup
    root = add(c, a, "根分类")
    leaf = add(c, a, "可移动")
    move = lambda id, department, parent=None: c.post('/api/template-categories/'+id+'/move', json={'department_id':department, 'parent_id':parent})
    assert move(leaf['id'], a, root['id']).status_code == 200
    assert move(leaf['id'], a).status_code == 200
    assert move(leaf['id'], a, root['id']).status_code == 200
    with factory() as db:
        live = Template(name='关联模板', category_id=leaf['id'], department_id=a, shared=False)
        history = Template(name='已删除模板', category_id=root['id'], department_id=a, shared=False, status='deleted')
        db.add_all([live, history]); db.commit(); tids=[live.id, history.id]
    result=move(root['id'], b)
    assert result.status_code==200 and result.json()['templates']==2
    with factory() as db:
        assert db.get(Category,leaf['id']).parent_id==root['id']
        assert all(db.get(Category,id).department_id==b for id in [root['id'],leaf['id']])
        assert all(db.get(Template,id).department_id==b and not db.get(Template,id).shared for id in tids)
    assert move(root['id'],None).status_code==200
    with factory() as db:
        assert all(db.get(Template,id).department_id is None and db.get(Template,id).shared for id in tids)
        assert db.scalar(select(Audit).where(Audit.action=='category.move'))


def test_drag_rejects_cycles_third_level_duplicates_and_nonadmin_without_mutation(setup):
    c, factory, a, b, user=setup
    root=add(c,a,'根');child=add(c,a,'子',root['id']);target=add(c,b,'目标');other=add(c,b,'根')
    move=lambda id, department, parent=None:c.post('/api/template-categories/'+id+'/move',json={'department_id':department,'parent_id':parent})
    assert move(root['id'],a,child['id']).status_code==422
    assert move(root['id'],b,target['id']).status_code==422
    assert move(root['id'],b).status_code==409
    assert move(child['id'],a,child['id']).status_code==422
    assert move(child['id'],a,target['id']).status_code==422
    assert move(child['id'],'missing').status_code==422
    assert move('missing',a).status_code==404
    c.patch('/api/template-categories/'+target['id'],json={'active':False})
    assert move(child['id'],b,target['id']).status_code==422
    with factory() as db:
        assert db.get(Category,root['id']).department_id==a
        assert db.get(Category,child['id']).parent_id==root['id']
    user.role='contributor'
    assert move(child['id'],b).status_code==403
