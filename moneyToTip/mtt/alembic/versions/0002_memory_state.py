"""Persist minute-level memory state and review decision snapshots.

Revision ID: 0002_memory_state
Revises: 0001_baseline
"""

import math
from datetime import UTC, datetime
from typing import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0002_memory_state"
down_revision: str | None = "0001_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _local_midnight_as_utc(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%d").astimezone().astimezone(UTC)


def upgrade() -> None:
    bind = op.get_bind()
    bind.exec_driver_sql("""
        DELETE FROM questionstate
        WHERE id NOT IN (
            SELECT MAX(id) FROM questionstate GROUP BY user_id, question_id
        )
    """)

    with op.batch_alter_table("questionstate") as batch:
        batch.add_column(sa.Column("due_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("stability_days", sa.Float(), nullable=False,
                                   server_default="1"))
        batch.add_column(sa.Column("interval_minutes", sa.Integer(), nullable=False,
                                   server_default="0"))
        batch.add_column(sa.Column("lapses", sa.Integer(), nullable=False,
                                   server_default="0"))
        batch.add_column(sa.Column("last_rating", sa.String(), nullable=False,
                                   server_default=""))
        batch.add_column(sa.Column("last_reviewed_at", sa.DateTime(timezone=True),
                                   nullable=True))
        batch.add_column(sa.Column("algorithm_version", sa.String(), nullable=False,
                                   server_default="ebbinghaus-v1"))

    bind.exec_driver_sql(
        """UPDATE questionstate
           SET interval_minutes = interval_days * 1440,
               stability_days = MAX(interval_days / :log_retention, :minimum),
               status = CASE status WHEN 'mastered' THEN 'review' ELSE status END""",
        {"log_retention": -math.log(0.85), "minimum": 1 / 1440},
    )
    rows = bind.exec_driver_sql("SELECT id, due_date FROM questionstate").all()
    for state_id, due_date in rows:
        bind.exec_driver_sql(
            "UPDATE questionstate SET due_at = :due_at WHERE id = :state_id",
            {"due_at": _local_midnight_as_utc(due_date).isoformat(), "state_id": state_id},
        )
    bind.exec_driver_sql("""
        UPDATE questionstate
        SET last_rating = COALESCE((
                SELECT rating FROM reviewlog
                WHERE reviewlog.user_id = questionstate.user_id
                  AND reviewlog.question_id = questionstate.question_id
                ORDER BY reviewed_at DESC, id DESC LIMIT 1
            ), ''),
            last_reviewed_at = (
                SELECT reviewed_at FROM reviewlog
                WHERE reviewlog.user_id = questionstate.user_id
                  AND reviewlog.question_id = questionstate.question_id
                ORDER BY reviewed_at DESC, id DESC LIMIT 1
            )
    """)

    with op.batch_alter_table("reviewlog") as batch:
        batch.add_column(sa.Column("plan_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("decision_due_at", sa.DateTime(timezone=True),
                                   nullable=True))
        batch.add_column(sa.Column("decision_interval_minutes", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("decision_algorithm_version", sa.String(), nullable=False,
                                   server_default=""))
        batch.create_foreign_key("fk_reviewlog_plan_id", "plan", ["plan_id"], ["id"])
        batch.create_index("ix_reviewlog_plan_id", ["plan_id"])

    with op.batch_alter_table("questionstate") as batch:
        batch.alter_column("due_at", existing_type=sa.DateTime(timezone=True), nullable=False)
        batch.drop_column("due_date")
        batch.drop_column("interval_days")
        batch.create_index(
            "uq_questionstate_user_question", ["user_id", "question_id"], unique=True
        )
        batch.create_index("ix_questionstate_due_at", ["due_at"])


def downgrade() -> None:
    raise NotImplementedError("Memory-state migration is not reversible without data loss")
