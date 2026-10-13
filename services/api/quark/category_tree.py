"""Department category rules shared by imports and category maintenance."""
from fastapi import HTTPException
from sqlalchemy import select
from .db import Category, Department, Template


def descendants(rows, category_id):
    result = {category_id}
    while True:
        expanded = result | {c.id for c in rows if c.parent_id in result}
        if expanded == result:
            return result
        result = expanded


def validate_category(db, category_id, department_id):
    category = db.get(Category, category_id) if category_id else None
    if not category or not category.active:
        raise HTTPException(422, "请选择启用的模板分类")
    if category.parent_id:
        parent = db.get(Category, category.parent_id)
        if not parent or not parent.active:
            raise HTTPException(422, "上级分类已停用")
    if category.department_id and category.department_id != department_id:
        raise HTTPException(422, "模板分类与所属部门不一致，请重新选择")
    return category


def validate_location(db, rows, category_id, department_id, parent_id, active):
    if department_id and not db.get(Department, department_id):
        raise HTTPException(422, "所属部门不存在")
    parent = next((c for c in rows if c.id == parent_id), None) if parent_id else None
    if parent_id:
        if not parent or parent.id == category_id or parent.parent_id:
            raise HTTPException(422, "请选择一级分类作为上级，分类最多支持两级")
        if parent.department_id != department_id:
            raise HTTPException(422, "父子分类必须属于同一部门")
        if active and not parent.active:
            raise HTTPException(422, "上级分类停用时不能启用子分类")
        if category_id and any(c.parent_id == category_id for c in rows):
            raise HTTPException(422, "已有子分类的一级分类不能改为二级分类")
    current = next((c for c in rows if c.id == category_id), None)
    if current and current.department_id != department_id:
        if any(c.parent_id == current.id for c in rows):
            raise HTTPException(422, "请先调整子分类后再变更所属部门")
        if department_id and db.scalar(select(Template.id).where(
                Template.category_id == current.id, Template.status != "deleted",
                (Template.department_id != department_id) | Template.department_id.is_(None)).limit(1)):
            raise HTTPException(422, "已有模板的所属部门不一致，不能变更分类部门")
