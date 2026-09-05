"""Add research and research_status to clients

Revision ID: 007
Revises: 006
Create Date: 2026-04-14

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from alembic import op

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("clients", sa.Column("research", JSONB, nullable=True))
    op.add_column("clients", sa.Column("research_status", sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column("clients", "research_status")
    op.drop_column("clients", "research")
