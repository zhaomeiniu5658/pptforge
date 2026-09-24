"""Stored models are shared by API and worker; credentials never enter job payloads."""
import os, base64, hashlib
from urllib.parse import urlsplit
from typing import Literal
from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select, update, text
from .db import ModelProfile, SessionLocal
from .security import current_user, db_session, admin
from .content import audit

router = APIRouter(prefix='/api/models', tags=['Models'])


def cipher():
    secret = os.getenv('MODEL_ENCRYPTION_KEY') or os.getenv('TOOL_SECRET', '')
    if not secret or secret == 'quark-local-tools-change-me':
        raise ValueError('保存模型前需在服务端配置 MODEL_ENCRYPTION_KEY 或独立 TOOL_SECRET')
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))


def public_model(m, admin_view=False):
    result = {k: getattr(m, k) for k in ('id', 'name', 'provider', 'model_name', 'enabled',
                                      'supports_images', 'default_text', 'default_image')}
    if admin_view:
        result.update(base_url=m.base_url, has_api_key=bool(m.encrypted_key))
    return result


def model_config(m):
    return dict(name=m.model_name, provider=m.provider, base_url=m.base_url,
                key=cipher().decrypt(m.encrypted_key.encode()).decode() if m.encrypted_key else '')


def resolve_model(db, model_id=None, has_images=False):
    if model_id:
        m = db.get(ModelProfile, model_id)
    else:
        column = ModelProfile.default_image if has_images else ModelProfile.default_text
        m = db.scalar(select(ModelProfile).where(column == True, ModelProfile.enabled == True))
    if not m or not m.enabled:
        raise ValueError('尚未配置可用的图片模型，请联系管理员添加支持图片的模型并设为默认。'
                         if has_images else '尚未配置可用模型，请联系管理员设置文字默认模型。')
    if has_images and not m.supports_images:
        raise ValueError('所选模型未启用图片输入，请选择标有“文字 + 图片”的模型。')
    return m


def load_model(model_id, has_images=False):
    with SessionLocal() as db:
        return model_config(resolve_model(db, model_id, has_images))


def seed_env_model():
    """Import the existing deployment once; later UI edits are authoritative."""
    if not os.getenv('MODEL_NAME'):
        return
    with SessionLocal() as db:
        if db.scalar(select(ModelProfile.id).limit(1)):
            return
        key = os.getenv('MODEL_API_KEY', '')
        db.add(ModelProfile(name=os.environ['MODEL_NAME'], model_name=os.environ['MODEL_NAME'],
                            provider=os.getenv('MODEL_PROVIDER', 'openai'),
                            base_url=os.getenv('MODEL_BASE_URL', 'https://api.openai.com/v1'),
                            encrypted_key=cipher().encrypt(key.encode()).decode() if key else '',
                            supports_images=os.getenv('MODEL_SUPPORTS_IMAGES', 'false') == 'true',
                            default_text=True))
        db.commit()


class ModelIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    provider: Literal['openai', 'anthropic', 'gemini', 'ollama']
    base_url: str = Field(min_length=1, max_length=2000)
    model_name: str = Field(min_length=1, max_length=200)
    api_key: str | None = Field(default=None, max_length=4096)
    clear_key: bool = False
    enabled: bool = True
    supports_images: bool = False
    default_text: bool = False
    default_image: bool = False

    @model_validator(mode='after')
    def valid(self):
        self.name, self.model_name = self.name.strip(), self.model_name.strip()
        self.base_url = self.base_url.strip().rstrip('/')
        try:
            u = urlsplit(self.base_url)
            valid = u.scheme in ('http', 'https') and u.hostname and not u.username and not u.password and not u.query and not u.fragment
        except ValueError:
            valid = False
        if not valid or not self.name or not self.model_name:
            raise ValueError('请输入有效名称和 HTTP(S) Base URL；密钥请单独填写')
        if (self.default_text or self.default_image) and not self.enabled:
            raise ValueError('默认模型必须启用，请先取消默认再停用')
        if self.default_image and not self.supports_images:
            raise ValueError('图片默认模型必须支持图片输入')
        return self


@router.get('')
def list_models(u=Depends(current_user), db=Depends(db_session)):
    q = select(ModelProfile).order_by(ModelProfile.created_at)
    if u.role != 'admin':
        q = q.where(ModelProfile.enabled == True)
    return [public_model(m, u.role == 'admin') for m in db.scalars(q)]


def save_model(body, u, db, model_id=None):
    admin(u)
    # Serialize default changes, including the empty-table first insert.
    db.execute(text("SELECT pg_advisory_xact_lock(71340219)"))
    m = db.get(ModelProfile, model_id) if model_id else ModelProfile()
    if not m:
        raise HTTPException(404, '模型配置不存在')
    for field in ('default_text', 'default_image'):
        if getattr(body, field):
            db.execute(update(ModelProfile).where(getattr(ModelProfile, field) == True).values({field: False}))
    for k, v in body.model_dump(exclude={'api_key', 'clear_key'}).items():
        setattr(m, k, v)
    if body.clear_key:
        m.encrypted_key = ''
    elif body.api_key:
        m.encrypted_key = cipher().encrypt(body.api_key.encode()).decode()
    db.add(m)
    db.flush()
    audit(db, u, 'model.configure', m.id, {'name': m.name, 'provider': m.provider})
    db.commit()
    return public_model(m, True)


@router.post('', status_code=201)
def add_model(body: ModelIn, u=Depends(current_user), db=Depends(db_session)):
    return save_model(body, u, db)


@router.put('/{model_id}')
def edit_model(model_id: str, body: ModelIn, u=Depends(current_user), db=Depends(db_session)):
    return save_model(body, u, db, model_id)


@router.post('/{model_id}/test')
def test_model(model_id: str, u=Depends(current_user), db=Depends(db_session)):
    admin(u)
    m = resolve_model(db, model_id)
    config = model_config(m)
    images = []
    if m.supports_images:
        from PIL import Image
        import io
        buf = io.BytesIO()
        Image.new('RGB', (64, 64), '#2563eb').save(buf, format='PNG')
        images = ['data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()]
    from .model_gateway import generate
    generate('连接测试：只输出一个很短的完整 HTML 页面，标题“连接成功”。'
             + ('用一句话描述附图颜色。' if images else ''), images, config=config)
    audit(db, u, 'model.test', m.id, {'images': bool(images)})
    db.commit()
    return {'ok': True, 'message': '图片请求已通过，服务返回 HTML。' if images else '文字请求已通过，服务返回 HTML。'}
