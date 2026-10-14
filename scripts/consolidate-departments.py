"""Consolidate the department catalog without deleting accounts or assets.

Dry-run is the default. --apply requires an explicit destination for the old
external-collaboration department. Run in each authorized database environment.
"""
import argparse
import json
from pathlib import Path
from sqlalchemy import select, update, delete
from quark.db import SessionLocal, Department, User, Template, Category, Audit

KEEP = ["总经办", "商务拓展部", "市场部", "临床运营中心", "器械事业部", "医学部", "SMO", "数统部", "辐射剂量学部", "质量保证部", "药品注册部", "AI&IT事业部", "财务部", "综合管理部"]
MERGE = {"研发医学部":"医学部", "临床运营部":"临床运营中心", "生物统计室":"数统部", "注册法规处":"药品注册部", "商务部":"商务拓展部", "质量管理部":"质量保证部", "临床运营一部":"临床运营中心", "临床运营二部":"临床运营中心", "临床运营三部":"临床运营中心", "CNS事业部":"医学部", "中央项目管理":"商务拓展部", "商务一部":"商务拓展部", "商务二部":"商务拓展部", "商务运营支持":"商务拓展部"}

def run(apply=False, external=None, backup=None):
    with SessionLocal() as db:
        departments = list(db.scalars(select(Department)))
        by_name = {d.name:d for d in departments}
        missing = set(KEEP + ["夸克医药"]) - by_name.keys()
        if missing:
            raise ValueError("Missing expected departments: " + ",".join(sorted(missing)))
        mapping = dict(MERGE)
        if "外部协作" in by_name:
            if external is not None:
                mapping["外部协作"] = external or None
            elif apply:
                raise ValueError("Specify the approved external department destination")
        unknown = set(by_name) - set(KEEP) - {"夸克医药", "外部协作"} - set(MERGE)
        if unknown:
            raise ValueError("Unexpected departments: " + ",".join(sorted(unknown)))
        snapshots = {}
        for model in (Department, User, Template, Category):
            snapshots[model.__tablename__] = [{"id":x.id, **({"name":x.name,"parent_id":x.parent_id} if model is Department else {"department_id":x.department_id})} for x in db.scalars(select(model))]
        moved = {}
        for old, new in mapping.items():
            if old not in by_name: continue
            did = by_name[old].id
            moved[old] = {"destination":new, **{m.__tablename__:sum(x['department_id']==did for x in snapshots[m.__tablename__]) for m in (User,Template,Category)}}
        if apply:
            if not backup: raise ValueError("Backup path is required")
            backup.parent.mkdir(parents=True,exist_ok=True);backup.parent.chmod(0o700)
            backup.write_text(json.dumps(snapshots,ensure_ascii=False,indent=2));backup.chmod(0o600)
            actor = db.scalar(select(User).where(User.role=="admin", User.active==True))
            if not actor:raise ValueError("No active admin for audit")
            for old,new in mapping.items():
                if old not in by_name:continue
                target = by_name[new].id if new else None
                for model in (User,Template,Category):
                    db.execute(update(model).where(model.department_id==by_name[old].id).values(department_id=target))
            root = by_name['夸克医药']
            # All retained departments are siblings beneath the company root.
            for name in KEEP:by_name[name].parent_id=root.id
            db.flush()
            for old in mapping:
                if old in by_name:db.execute(delete(Department).where(Department.id==by_name[old].id))
            db.add(Audit(actor_id=actor.id,action="department.consolidate",entity_id=root.id,details={"departments":KEEP,"merged":moved}))
            db.commit()
        return {"applied":apply,"retained_department_count":len(KEEP),"company_root_retained":True,"merged":moved,"external_pending":"外部协作" in by_name and external is None}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');p.add_argument('--external',choices=['综合管理部','unassigned']);p.add_argument('--backup',type=Path)
    a=p.parse_args();print(json.dumps(run(a.apply,'' if a.external=='unassigned' else a.external,a.backup),ensure_ascii=False))
