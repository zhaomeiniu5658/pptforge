"""Import Quarkmed contacts exported to JSON into the local PostgreSQL database.

The current schema stores one primary department per user. For a contact with
multiple department paths, the deepest path is selected deterministically.
This script is idempotent by normalized email username and never deletes users.
"""
from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

from sqlalchemy import select

from quark.db import Audit, Department, SessionLocal, User
from quark.security import hash_password

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
REQUIRED = ("姓名", "用户名", "邮箱", "部门", "姓名拼音")


def load_rows(path: Path) -> list[dict]:
    rows = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(rows, list) or not rows:
        raise ValueError("通讯录数据为空或格式不正确")
    cleaned = []
    for index, row in enumerate(rows, start=1):
        if not isinstance(row, dict):
            raise ValueError(f"第 {index} 行不是对象")
        missing = [key for key in REQUIRED if not str(row.get(key, "")).strip()]
        if missing:
            raise ValueError(f"第 {index} 行缺少字段：{', '.join(missing)}")
        cleaned.append({key: str(row[key]).strip() for key in REQUIRED})
    return cleaned


def validate(rows: list[dict]) -> None:
    emails = [row["邮箱"].lower() for row in rows]
    usernames = [row["用户名"].lower() for row in rows]
    bad = [email for email in emails if not EMAIL_RE.fullmatch(email)]
    if bad:
        raise ValueError("邮箱格式不正确：" + ", ".join(bad[:5]))
    if any(not re.fullmatch(r"[a-z]+", row["姓名拼音"]) for row in rows):
        raise ValueError("姓名拼音必须为按姓名顺序的小写全拼，不含空格或标点")
    for label, values in (("邮箱", emails), ("用户名", usernames)):
        duplicates = sorted(value for value, count in Counter(values).items() if count > 1)
        if duplicates:
            raise ValueError(f"通讯录中存在重复{label}：" + ", ".join(duplicates[:10]))


def paths_for(row: dict) -> list[list[str]]:
    result = []
    for raw in row["部门"].split(";"):
        parts = [part.strip() for part in raw.split("/") if part.strip()]
        if parts:
            result.append(parts)
    if not result:
        raise ValueError(f"{row['邮箱']} 没有有效部门")
    return result


def import_rows(rows: list[dict], source: str) -> dict:
    validate(rows)
    with SessionLocal() as db:
        # Validate all existing email usernames before mutating anything.
        incoming = {row["邮箱"].lower() for row in rows}
        existing_by_username = {
            user.username.lower(): user
            for user in db.scalars(select(User)).all()
            if user.username
        }
        conflicts = sorted(incoming.intersection(existing_by_username))

        # Build and validate the complete path tree first.
        paths = sorted(
            {tuple(path[:i]) for row in rows for path in paths_for(row) for i in range(1, len(path) + 1)},
            key=lambda p: (len(p), p),
        )
        path_nodes: dict[tuple[str, ...], Department] = {}
        created_departments = 0
        reparented_departments = []
        for path in paths:
            parent = path_nodes.get(path[:-1])
            expected_parent_id = parent.id if parent else None
            name = path[-1]
            department = db.scalar(select(Department).where(Department.name == name))
            if department is None:
                department = Department(name=name, parent_id=expected_parent_id)
                db.add(department)
                db.flush()
                created_departments += 1
            elif department.parent_id != expected_parent_id:
                # Existing demo data has a top-level 辐射剂量学部. It is the
                # only known collision and must be mounted under 夸克医药.
                if name == "辐射剂量学部" and path == ("夸克医药", "辐射剂量学部"):
                    department.parent_id = expected_parent_id
                    reparented_departments.append(name)
                else:
                    existing_parent = db.get(Department, department.parent_id) if department.parent_id else None
                    existing_parent_name = existing_parent.name if existing_parent else "根级"
                    expected_parent_name = parent.name if parent else "根级"
                    raise ValueError(
                        f"部门层级冲突：{name} 当前上级为 {existing_parent_name}，"
                        f"通讯录要求上级为 {expected_parent_name}"
                    )
            path_nodes[path] = department

        # Pick the deepest department path as the single primary department.
        created_users = 0
        updated_users = 0
        for row in rows:
            email = row["邮箱"].lower()
            all_paths = paths_for(row)
            primary_path = max(enumerate(all_paths), key=lambda item: (len(item[1]), -item[0]))[1]
            department = path_nodes[tuple(primary_path)]
            user = existing_by_username.get(email)
            if user is None:
                user = User(username=email, name=row["姓名"], role="contributor", employee_no="")
                db.add(user)
                created_users += 1
            else:
                updated_users += 1
            user.name = row["姓名"]
            user.password_hash = hash_password(row["姓名拼音"] + "999999")
            user.role = "contributor"
            user.department_id = department.id
            user.employee_no = ""
            user.active = True

        db.flush()
        admin = db.scalar(select(User).where(User.role == "admin").order_by(User.created_at))
        if not admin:
            raise ValueError("数据库中没有管理员账号，无法写入导入审计")
        root = path_nodes.get(("夸克医药",))
        db.add(
            Audit(
                actor_id=admin.id,
                action="user.bulk_import",
                entity_id=root.id if root else admin.id,
                details={
                    "source": source,
                    "rows": len(rows),
                    "created_users": created_users,
                    "updated_users": updated_users,
                    "created_departments": created_departments,
                    "reparented_departments": reparented_departments,
                    "existing_email_matches": conflicts,
                    "department_rule": "multiple paths use deepest path as primary department",
                    "password_rule": "lowercase full name pinyin in Chinese name order + 999999",
                    "multiple_department_sources": [
                        {"username": row["邮箱"].lower(), "paths": paths_for(row)}
                        for row in rows if len(paths_for(row)) > 1
                    ],
                },
            )
        )
        db.commit()
        return {
            "rows": len(rows),
            "created_users": created_users,
            "updated_users": updated_users,
            "created_departments": created_departments,
            "reparented_departments": reparented_departments,
            "existing_email_matches": conflicts,
            "department_paths": len(paths),
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("json_path", type=Path)
    parser.add_argument("--source-name", default="夸克医药通讯录1.xlsx")
    args = parser.parse_args()
    rows = load_rows(args.json_path)
    result = import_rows(rows, args.source_name)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
