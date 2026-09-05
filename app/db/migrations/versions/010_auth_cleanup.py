"""Remove agency OAuth credential columns (now app-level env vars)

Revision ID: 010
Revises: 009
Create Date: 2026-04-18

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("agencies", "google_oauth_client_id")
    op.drop_column("agencies", "google_oauth_client_secret")


def downgrade() -> None:
    op.add_column("agencies", sa.Column("google_oauth_client_secret", sa.Text, nullable=True))
    op.add_column("agencies", sa.Column("google_oauth_client_id", sa.Text, nullable=True))
