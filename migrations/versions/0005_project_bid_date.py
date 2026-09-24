"""Persist the project bidding date."""

from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"


def upgrade():
    op.add_column(
        "projects",
        sa.Column("bid_date", sa.String(10), nullable=False, server_default=""),
    )


def downgrade():
    op.drop_column("projects", "bid_date")
