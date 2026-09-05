"""Initial schema

Revision ID: 001
Revises:
Create Date: 2026-04-04

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "strategy",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("business_name", sa.String(255), nullable=False),
        sa.Column("icp", JSONB, server_default="{}"),
        sa.Column("voice", JSONB, server_default="{}"),
        sa.Column("positioning", JSONB, server_default="{}"),
        sa.Column("messaging", JSONB, server_default="{}"),
        sa.Column("goals", JSONB, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "task_configs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("task_type", sa.String(100), unique=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("pipeline", JSONB, server_default="[]"),
        sa.Column("schedule", sa.String(100), nullable=True),
        sa.Column("active", sa.Boolean(), server_default="true"),
    )
    op.create_index("ix_task_configs_task_type", "task_configs", ["task_type"])

    op.create_table(
        "runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("task_type", sa.String(100), nullable=False),
        sa.Column("status", sa.String(50), server_default="running"),
        sa.Column("context_snapshot", JSONB, nullable=True),
        sa.Column("output", JSONB, nullable=True),
        sa.Column("debrief", JSONB, nullable=True),
        sa.Column("slack_message_ts", sa.String(50), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_runs_task_type", "runs", ["task_type"])

    op.create_table(
        "feedback",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("run_id", sa.Uuid(), sa.ForeignKey("runs.id"), nullable=False),
        sa.Column("asset_index", sa.Integer(), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_feedback_run_id", "feedback", ["run_id"])

    op.create_table(
        "assets",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("run_id", sa.Uuid(), sa.ForeignKey("runs.id"), nullable=False),
        sa.Column("type", sa.String(50), nullable=False),
        sa.Column("content", JSONB, server_default="{}"),
        sa.Column("rating", sa.Integer(), nullable=True),
        sa.Column("saved_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_assets_run_id", "assets", ["run_id"])

    op.create_table(
        "memory_summaries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("insights", JSONB, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("memory_summaries")
    op.drop_table("assets")
    op.drop_table("feedback")
    op.drop_table("runs")
    op.drop_table("task_configs")
    op.drop_table("strategy")
