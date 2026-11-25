"""Store per-user application preferences.

Revision ID: 0003_user_preferences
Revises: 0002_memory_state
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0003_user_preferences"
down_revision: str | None = "0002_memory_state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "userpreference",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("user.id"), nullable=False),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", sa.String(), nullable=False),
    )
    op.create_index("ix_userpreference_user_id", "userpreference", ["user_id"])
    op.create_index("uq_userpreference_user_key", "userpreference", ["user_id", "key"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_userpreference_user_key", table_name="userpreference")
    op.drop_index("ix_userpreference_user_id", table_name="userpreference")
    op.drop_table("userpreference")
