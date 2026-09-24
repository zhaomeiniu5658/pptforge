import os, secrets
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from .db import *
from .security import hash_password


def document(title, subtitle="", kind=0):
    colors = [
        ("#071126", "#5b9eff"),
        ("#fff", "#2563eb"),
        ("#062e2c", "#2dd4bf"),
        ("#1e133b", "#bd93f9"),
    ]
    bg, accent = colors[kind % 4]
    fg = "#f5f7ff" if bg != "#fff" else "#10213d"
    return {
        "schemaVersion": 1,
        "html": f'<section class="cover"><div class="eyebrow">QUARKMED · CLINICAL INTELLIGENCE</div><div class="rule"></div><p class="kicker">临床研究 · 方案工作稿</p><h1 data-node-id="title">{title}</h1><p class="subtitle" data-node-id="subtitle">{subtitle or "请根据项目实际资料完善本页内容，医学数据须经专业核对。"}</p><div class="metrics"><div><small>PROJECT</small><p>研究方案</p></div><div><small>STATUS</small><p>待完善内容</p></div><div><small>QUARKMED</small><p>夸克医药</p></div></div><footer>INTERNAL WORKING DOCUMENT <span>内部工作稿</span></footer></section>',
        "css": f'.cover{{background:{bg};color:{fg};padding:48px 56px;min-height:560px;font-family:Arial,"Noto Sans CJK SC",sans-serif;box-sizing:border-box}} .eyebrow{{letter-spacing:3px;color:{accent};font-size:12px}} .rule{{height:1px;background:currentColor;opacity:.15;margin:26px 0 52px}} .kicker{{color:{accent};font-size:14px}} h1{{font-size:38px;line-height:1.4;max-width:860px;margin:20px 0}} .subtitle{{opacity:.7;font-size:17px;line-height:1.8;max-width:900px}} .metrics{{display:flex;gap:16px;margin-top:48px}} .metrics>div{{background:#88888812;flex:1;padding:20px;border:1px solid #88888822;border-radius:8px}} small{{font-size:10px;letter-spacing:2px;opacity:.5}} footer{{margin-top:36px;font-size:10px;opacity:.5}} footer span{{float:right}}',
        "assets": [],
        "interactions": [],
        "layoutMode": "flow",
        "editableNodes": [],
        "sourceReferences": [],
        "diagnostics": [],
    }


def seed():
    with SessionLocal() as db:
        if db.scalar(select(User)):
            return
        names = [
            "研发医学部",
            "临床运营部",
            "生物统计室",
            "注册法规处",
            "商务部",
            "质量管理部",
            "辐射剂量学部",
        ]
        ds = [Department(name=n) for n in names]
        db.add_all(ds)
        db.flush()
        password = os.getenv("BOOTSTRAP_ADMIN_PASSWORD")
        if not password:
            password = secrets.token_urlsafe(16)
            print("首次管理员随机密码（请保存并修改）: " + password, flush=True)
        a = User(
            username="admin",
            name="系统管理员",
            role="admin",
            department_id=ds[0].id,
            password_hash=hash_password(password),
            employee_no="QM-0001",
        )
        db.add(a)
        cats = [
            Category(name=n, position=i)
            for i, n in enumerate(
                [
                    "通用",
                    "公司介绍",
                    "医学",
                    "辐射剂量学",
                    "临床运营",
                    "质量管理",
                    "数统",
                    "注册",
                ]
            )
        ]
        db.add_all(cats)
        db.flush()
        if os.getenv("SEED_DEMO", "false").lower() == "true":
            bd = User(
                username="bd",
                name="李思远",
                role="business",
                department_id=ds[4].id,
                password_hash=hash_password(password),
                employee_no="QM-0101",
            )
            writer = User(
                username="writer",
                name="张立明",
                role="contributor",
                department_id=ds[0].id,
                password_hash=hash_password(password),
                employee_no="QM-0201",
            )
            stat = User(
                username="stat",
                name="周若宁",
                role="contributor",
                department_id=ds[2].id,
                password_hash=hash_password(password),
                employee_no="QM-0301",
            )
            db.add_all([bd, writer, stat])
            db.flush()
            p = Project(
                name="创新药临床研究项目方案",
                code="QM-DEMO-001",
                description="演示项目：用于验证分工、内容制作与审核流程；不包含真实临床数据。",
                business_id=bd.id,
                leader_id=writer.id,
                deadline=(now() + timedelta(days=2)).isoformat(),
                field="肿瘤",
            )
            db.add(p)
            db.flush()
            db.add_all(
                [
                    Member(project_id=p.id, user_id=u.id, responsibility="专业分册编写")
                    for u in [writer, stat]
                ]
            )
            for i, (u, title) in enumerate(
                [
                    (writer, "临床方案架构与受试者入组终点"),
                    (stat, "统计分析与样本量论证"),
                ]
            ):
                b = Booklet(
                    project_id=p.id,
                    owner_id=u.id,
                    title=title,
                    deadline=p.deadline,
                    position=i,
                    expected_pages=4,
                    instructions="使用公司规范，核对所有医学术语、数值与来源。",
                )
                db.add(b)
                db.flush()
                for j, t in enumerate(
                    [
                        "项目方案首页",
                        "立项背景与需求",
                        "作用机制与研究设计",
                        "执行摘要与里程碑",
                    ]
                ):
                    pg = Page(booklet_id=b.id, title=t, position=j)
                    db.add(pg)
                    db.flush()
                    r = Revision(
                        page_id=pg.id,
                        actor_id=u.id,
                        document=document(t, p.description, j),
                        source="seed",
                    )
                    db.add(r)
                    db.flush()
                    pg.current_revision_id = r.id
            for i, t in enumerate(
                [
                    "临床方案封面",
                    "研究背景与科学依据",
                    "受试者入排标准",
                    "临床执行里程碑",
                    "统计分析方案",
                    "质量管理与风险控制",
                    "公司能力介绍",
                    "注册沟通策略",
                ]
            ):
                tp = Template(
                    name=t,
                    category_id=cats[[0, 2, 2, 4, 6, 5, 1, 7][i]].id,
                    department_id=ds[0].id,
                    shared=True,
                    status="published",
                )
                db.add(tp)
                db.flush()
                v = TemplateVersion(
                    template_id=tp.id, documents=[document(t, kind=i)], published=True
                )
                db.add(v)
                db.flush()
                tp.current_version_id = v.id
        db.commit()
