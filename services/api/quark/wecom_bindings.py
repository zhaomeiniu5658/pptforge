"""Bootstrap explicit account bindings from private server configuration.

Run with the normal .env loader: python -m quark.wecom_bindings --actor admin
No HTTP password login or automatic name/email matching is used.
"""
import argparse
import json
import os

from sqlalchemy import select
from .db import SessionLocal, User
from .wecom import Binding, bind_members


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--actor", required=True, help="Existing administrator username for audit attribution")
    args = parser.parse_args()
    try:
        data = json.loads(os.getenv("WECOM_USER_BINDINGS", "[]"))
        if not isinstance(data, list) or not data:
            raise ValueError()
        bindings = [Binding.model_validate(row) for row in data]
    except (ValueError, TypeError):
        raise SystemExit("请在私密 .env 的 WECOM_USER_BINDINGS 配置非空的账号/UserID JSON 对应表；输入内容不会输出。") from None
    with SessionLocal() as db:
        actor = db.scalar(select(User).where(User.username == args.actor, User.role == "admin", User.active == True))
        if not actor:
            raise SystemExit("审计账号不是有效管理员")
        result = bind_members(bindings, actor, db)
        print(json.dumps(result))


if __name__ == "__main__":
    main()
