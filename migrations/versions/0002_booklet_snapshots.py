"""Freeze draft order as well as individual page revisions."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"


def upgrade():
    op.create_table(
        "booklet_snapshots",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "booklet_id", sa.String(36), sa.ForeignKey("booklets.id"), nullable=False
        ),
        sa.Column("actor_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("manifest", postgresql.JSONB(), nullable=False),
        sa.Column("reason", sa.String(40), nullable=False),
    )


def downgrade():
    op.drop_table("booklet_snapshots")
