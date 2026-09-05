"""Add content_quota to strategy table

Revision ID: 005
Revises: 004
Create Date: 2026-04-13

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from alembic import op

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "strategy",
        sa.Column("content_quota", JSONB, server_default="{}", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("strategy", "content_quota")
