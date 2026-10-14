"""Explicit, additive import of the department taxonomy transcribed from screenshots.
Run: python -m quark.category_catalog after migrations and department setup.
"""
import json
from pathlib import Path
from sqlalchemy import select, text
from .db import Category, Department, SessionLocal

CATALOG = json.loads((Path(__file__).parent / "data" / "department_categories.json").read_text())


def import_catalog(db):
    db.execute(text("SELECT pg_advisory_xact_lock(71340220)"))
    added = 0
    missing = []
    for department_name, roots in CATALOG.items():
        department_name = {"临床运营部": "临床运营中心", "质量管理部": "质量保证部"}.get(department_name, department_name)
        department = db.scalar(select(Department).where(Department.name == department_name))
        if not department:
            missing.append(department_name)
            continue
        for position, (name, children) in enumerate(roots.items()):
            root = db.scalar(select(Category).where(Category.department_id == department.id,
                                                    Category.parent_id.is_(None), Category.name == name))
            if not root:
                root = Category(name=name, department_id=department.id, position=position)
                db.add(root)
                db.flush()
                added += 1
            for child_position, child_name in enumerate(children):
                if not db.scalar(select(Category.id).where(Category.department_id == department.id,
                                                           Category.parent_id == root.id, Category.name == child_name)):
                    db.add(Category(name=child_name, department_id=department.id, parent_id=root.id,
                                    active=root.active, position=child_position))
                    added += 1
    db.commit()
    return {"added": added, "missing_departments": missing}


if __name__ == "__main__":
    with SessionLocal() as db:
        print(json.dumps(import_catalog(db), ensure_ascii=False))
