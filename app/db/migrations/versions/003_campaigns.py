"""Add campaigns table and campaign_id to assets

Revision ID: 003
Revises: 002
Create Date: 2026-04-06

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "campaigns",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="idea"),
        sa.Column("strategy", JSONB, server_default="{}"),
        sa.Column("content_plan", JSONB, server_default="{}"),
        sa.Column("feedback_history", JSONB, server_default="[]"),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_campaigns_status", "campaigns", ["status"])

    op.add_column(
        "assets",
        sa.Column("campaign_id", sa.Uuid(), sa.ForeignKey("campaigns.id"), nullable=True),
    )
    op.create_index("ix_assets_campaign_id", "assets", ["campaign_id"])


def downgrade() -> None:
    op.drop_index("ix_assets_campaign_id")
    op.drop_column("assets", "campaign_id")
    op.drop_table("campaigns")
