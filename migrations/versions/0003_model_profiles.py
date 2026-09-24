"""Multiple model providers with encrypted credentials and task routing."""
from alembic import op
import sqlalchemy as sa

revision = '0003'
down_revision = '0002'


def upgrade():
    op.create_table('model_profiles',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('name', sa.String(120), nullable=False, unique=True),
        sa.Column('provider', sa.String(30), nullable=False),
        sa.Column('base_url', sa.Text(), nullable=False),
        sa.Column('model_name', sa.String(200), nullable=False),
        sa.Column('encrypted_key', sa.Text(), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False),
        sa.Column('supports_images', sa.Boolean(), nullable=False),
        sa.Column('default_text', sa.Boolean(), nullable=False),
        sa.Column('default_image', sa.Boolean(), nullable=False),
    )
    # Database enforces one default per mode, including concurrent admin saves.
    op.create_index('uq_model_default_text', 'model_profiles', ['default_text'], unique=True,
                    postgresql_where=sa.text('default_text = true'))
    op.create_index('uq_model_default_image', 'model_profiles', ['default_image'], unique=True,
                    postgresql_where=sa.text('default_image = true'))


def downgrade():
    op.drop_table('model_profiles')
