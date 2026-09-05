"""Add campaign_id to runs table

Revision ID: 004
Revises: 003
Create Date: 2026-04-12

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "runs",
        sa.Column("campaign_id", sa.Uuid(), sa.ForeignKey("campaigns.id"), nullable=True),
    )
    op.create_index("ix_runs_campaign_id", "runs", ["campaign_id"])


def downgrade() -> None:
    op.drop_index("ix_runs_campaign_id")
    op.drop_column("runs", "campaign_id")
