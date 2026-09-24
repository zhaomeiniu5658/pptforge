"""Persist project type, schedule and leader contact information."""

from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"


def upgrade():
    for name, length in (
        ("project_type", 160),
        ("start_date", 10),
        ("leader_phone", 80),
        ("leader_email", 254),
    ):
        op.add_column("projects", sa.Column(name, sa.String(length), nullable=False, server_default=""))


def downgrade():
    for name in ("leader_email", "leader_phone", "start_date", "project_type"):
        op.drop_column("projects", name)
