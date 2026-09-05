"""Make asset run_id nullable for standalone assets

Revision ID: 002
Revises: 001
Create Date: 2026-04-06

"""
from typing import Sequence, Union

from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("assets", "run_id", nullable=True)


def downgrade() -> None:
    op.alter_column("assets", "run_id", nullable=False)
