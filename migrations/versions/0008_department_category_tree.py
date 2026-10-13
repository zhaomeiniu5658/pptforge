"""Department-specific two-level template categories; preserve existing IDs."""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"


def upgrade():
    op.add_column("template_categories", sa.Column("department_id", sa.String(36), nullable=True))
    op.add_column("template_categories", sa.Column("parent_id", sa.String(36), nullable=True))
    op.create_foreign_key("fk_category_department", "template_categories", "departments", ["department_id"], ["id"])
    op.create_foreign_key("fk_category_parent", "template_categories", "template_categories", ["parent_id"], ["id"])
    op.drop_constraint("template_categories_name_key", "template_categories", type_="unique")
    op.create_index("uq_category_scope_name", "template_categories",
                    [sa.text("coalesce(department_id, '')"), sa.text("coalesce(parent_id, '')"), "name"], unique=True)


def downgrade():
    # PostgreSQL refuses this if names across departments conflict; do not destroy data.
    op.create_unique_constraint("template_categories_name_key", "template_categories", ["name"])
    op.drop_index("uq_category_scope_name", table_name="template_categories")
    op.drop_constraint("fk_category_parent", "template_categories", type_="foreignkey")
    op.drop_constraint("fk_category_department", "template_categories", type_="foreignkey")
    op.drop_column("template_categories", "parent_id")
    op.drop_column("template_categories", "department_id")
