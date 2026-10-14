"""Scheme list performance checks in an isolated SQLite database."""
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from quark.db import Department, User, Category, Template, TemplateVersion, PptScheme, PptSchemeItem
from quark.main import ppt_scheme_summaries, ppt_scheme_out


def test_summaries_preserve_order_and_snapshot_counts_without_all_documents():
    engine = create_engine('sqlite://')
    for model in (Department, User, Category, Template, TemplateVersion, PptScheme, PptSchemeItem):
        model.__table__.create(engine)
    with Session(engine) as db:
        user = User(username='admin', name='管理员', role='admin', password_hash='unused')
        category = Category(name='通用')
        db.add_all([user, category]); db.flush()
        template = Template(name='模板', category_id=category.id)
        db.add(template);db.flush()
        version = TemplateVersion(template_id=template.id, documents=[{'html':'cover'}, {'html':'large-page-' * 10000}], published=True)
        current = TemplateVersion(template_id=template.id, documents=[{'html':'current'}], published=True)
        db.add_all([version, current]);db.flush();template.current_version_id=current.id
        schemes=[]
        for i in range(3):
            scheme=PptScheme(name=f'方案{i}', owner_id=user.id)
            db.add(scheme);db.flush()
            db.add(PptSchemeItem(scheme_id=scheme.id,template_id=template.id,template_version_id=version.id,position=0))
            schemes.append(scheme)
        empty=PptScheme(name='空方案',owner_id=user.id);db.add(empty);db.commit()
        queries=[]
        def capture(conn,cursor,statement,parameters,context,executemany):
            if statement.lstrip().startswith('SELECT'):queries.append(statement)
        # Materialize scheme attributes before measuring the summary query count.
        for scheme in schemes+[empty]:_ = scheme.name
        event.listen(engine,'before_cursor_execute',capture)
        result=ppt_scheme_summaries(db,schemes+[empty])
        event.remove(engine,'before_cursor_execute',capture)
        assert len(queries)==1  # fixed cost regardless of scheme count
        assert [row['name'] for row in result]==[s.name for s in schemes]+['空方案']
        for row in result[:3]:
            assert row['page_count']==2 and row['template_count']==1
            assert 'template' not in row['items'][0]
            assert row['items'][0]['template_version_id']==version.id
        assert result[-1]['page_count']==0
        full=ppt_scheme_out(db,schemes[0])
        assert len(full['items'][0]['template']['documents'])==2
        assert ppt_scheme_summaries(db,[])==[]
    engine.dispose()
