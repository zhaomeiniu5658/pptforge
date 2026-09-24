"""Real PostgreSQL/API configuration checks; never call paid providers."""
import uuid
import pytest
from sqlalchemy import select, delete, update
from fastapi.testclient import TestClient
from quark.db import SessionLocal, ModelProfile
from quark.model_profiles import cipher, resolve_model, load_model
from test_workflow import clients, workspace


@pytest.fixture()
def profile(clients):
    body = dict(name='QA model '+uuid.uuid4().hex[:6],provider='openai',
                base_url='https://unused.invalid/v1',model_name='test-model',
                api_key='secret-for-test',enabled=True,supports_images=False,
                default_text=False,default_image=False)
    r=clients['admin'].post('/models',json=body)
    assert r.status_code==201, r.text
    yield r.json(), body
    with SessionLocal() as db:
        db.execute(delete(ModelProfile).where(ModelProfile.id==r.json()['id']))
        db.commit()


def test_role_boundary_and_encrypted_key(clients,profile):
    m,body=profile
    assert clients['writer'].post('/models',json=body).status_code==403
    assert clients['writer'].post('/models/'+m['id']+'/test',json={}).status_code==403
    public=next(x for x in clients['writer'].get('/models').json() if x['id']==m['id'])
    assert 'base_url' not in public and 'has_api_key' not in public
    assert 'secret-for-test' not in str(public) and 'encrypted_key' not in public
    assert m['has_api_key'] and 'encrypted_key' not in m
    with SessionLocal() as db:
        encrypted=db.get(ModelProfile,m['id']).encrypted_key
        assert encrypted!='secret-for-test'
        assert cipher().decrypt(encrypted.encode()).decode()=='secret-for-test'
    r=clients['admin'].put('/models/'+m['id'],json={**body,'api_key':''})
    assert r.status_code==200 and r.json()['has_api_key']
    assert load_model(m['id'])['key']=='secret-for-test'
    r=clients['admin'].put('/models/'+m['id'],json={**body,'api_key':'','clear_key':True})
    assert r.status_code==200 and not r.json()['has_api_key']


def test_image_routing_and_disabled_model(clients,workspace,profile,monkeypatch):
    from quark import main
    m,body=profile
    p,b,u=workspace
    payload=dict(project_id=p['id'],booklet_id=b['id'],prompt='test',model_id=m['id'])
    # Use in-process HTTP for accepted dispatch so the real worker never calls a fake provider.
    monkeypatch.setattr(main,'dispatch',lambda db,user,kind,payload,pid:payload)
    local=TestClient(main.app, base_url="http://127.0.0.1:8011")
    local.cookies.update(clients['writer'].cookies)
    r=local.post('/api/ai/tasks',json=payload)
    assert r.status_code==202 and r.json()['model_id']==m['id']
    assert 'secret-for-test' not in r.text
    with SessionLocal() as db:
        with pytest.raises(ValueError,match='未启用图片'):
            resolve_model(db,m['id'],True)
    clients['admin'].put('/models/'+m['id'],json={**body,'enabled':False})
    assert local.post('/api/ai/tasks',json=payload).status_code==422
    assert all(x['id']!=m['id'] for x in clients['writer'].get('/models').json())


def test_separate_defaults_are_resolved_transactionally(profile):
    m,body=profile
    with SessionLocal() as db:
        current=resolve_model(db)
        db.execute(update(ModelProfile).values(default_image=False))
        candidate=db.get(ModelProfile,m['id'])
        candidate.supports_images=True
        candidate.default_image=True
        db.flush()
        assert resolve_model(db,has_images=True).id==candidate.id
        assert resolve_model(db).id==current.id
        # Roll back temporary default; do not change the user's configured defaults.
        db.rollback()


def test_invalid_defaults_and_url(clients,profile):
    m,body=profile
    for bad in ({'default_image':True},{'enabled':False,'default_text':True},
                {'base_url':'https://user:secret@example.com/v1'}):
        r=clients['admin'].put('/models/'+m['id'],json={**body,**bad})
        assert r.status_code==422


def test_worker_uses_selected_profile_without_credential_in_job(clients,workspace,profile,monkeypatch):
    from quark import tasks
    from quark.db import Job
    m,body=profile
    p,b,u=workspace
    observed=[]
    def fake_generate(prompt, images, *, config):
        observed.append(config)
        return '<html><body><h1>模型路由验收</h1></body></html>'
    monkeypatch.setattr(tasks,'generate',fake_generate)
    with SessionLocal() as db:
        j=Job(owner_id=u['writer']['id'],project_id=p['id'],kind='ai',
              payload=dict(project_id=p['id'],booklet_id=b['id'],model_id=m['id'],prompt='test'))
        db.add(j);db.commit();jid=j.id
    tasks.execute.run(jid)
    result=clients['writer'].get('/jobs/'+jid).json()
    assert result['status']=='succeeded',result
    assert observed[0]['name']=='test-model' and observed[0]['key']=='secret-for-test'
    assert 'secret-for-test' not in str(result)
