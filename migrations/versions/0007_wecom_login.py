"""Enterprise WeChat identities and single-use browser-bound OAuth states."""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"


def upgrade():
    op.create_table(
        "wecom_identities",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("corp_id", sa.String(100), nullable=False),
        sa.Column("wecom_userid", sa.String(128), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.UniqueConstraint("corp_id", "wecom_userid"),
        sa.UniqueConstraint("corp_id", "user_id"),
    )
    op.create_table(
        "wecom_login_states",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("state_hash", sa.String(64), unique=True, nullable=False),
        sa.Column("browser_hash", sa.String(64), nullable=False),
        sa.Column("next_path", sa.String(2000), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade():
    op.drop_table("wecom_login_states")
    op.drop_table("wecom_identities")
