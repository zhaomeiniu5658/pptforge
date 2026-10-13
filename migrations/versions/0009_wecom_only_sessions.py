"""Mark verified WeCom sessions; existing sessions remain untrusted local sessions."""
from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"


def upgrade():
    op.add_column("sessions", sa.Column("auth_provider", sa.String(20), nullable=False, server_default="local"))
    op.add_column("sessions", sa.Column("auth_corp_id", sa.String(100), nullable=True))


def downgrade():
    op.drop_column("sessions", "auth_corp_id")
    op.drop_column("sessions", "auth_provider")
