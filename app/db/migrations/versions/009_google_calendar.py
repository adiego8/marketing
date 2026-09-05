"""Add Google Calendar integration fields

Revision ID: 009
Revises: 008
Create Date: 2026-04-16

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Agency OAuth credentials + connection state
    op.add_column("agencies", sa.Column("google_oauth_client_id", sa.Text, nullable=True))
    op.add_column("agencies", sa.Column("google_oauth_client_secret", sa.Text, nullable=True))
    op.add_column("agencies", sa.Column("google_refresh_token", sa.Text, nullable=True))
    op.add_column("agencies", sa.Column("google_connected_email", sa.String(255), nullable=True))

    # Per-client calendar
    op.add_column("clients", sa.Column("google_calendar_id", sa.String(255), nullable=True))

    # Asset scheduling
    op.add_column("assets", sa.Column("asset_index", sa.Integer, nullable=True))
    op.add_column("assets", sa.Column("scheduled_for", sa.DateTime, nullable=True))
    op.add_column("assets", sa.Column("suggested_scheduled_for", sa.DateTime, nullable=True))
    op.add_column("assets", sa.Column("posted_at", sa.DateTime, nullable=True))
    op.add_column("assets", sa.Column("status", sa.String(50), server_default="draft", nullable=False))
    op.add_column("assets", sa.Column("google_event_id", sa.String(255), nullable=True))

    op.create_index("ix_assets_scheduled_for", "assets", ["scheduled_for"])
    op.create_index("ix_assets_status", "assets", ["status"])


def downgrade() -> None:
    op.drop_index("ix_assets_status", "assets")
    op.drop_index("ix_assets_scheduled_for", "assets")

    op.drop_column("assets", "google_event_id")
    op.drop_column("assets", "status")
    op.drop_column("assets", "posted_at")
    op.drop_column("assets", "suggested_scheduled_for")
    op.drop_column("assets", "scheduled_for")
    op.drop_column("assets", "asset_index")

    op.drop_column("clients", "google_calendar_id")

    op.drop_column("agencies", "google_connected_email")
    op.drop_column("agencies", "google_refresh_token")
    op.drop_column("agencies", "google_oauth_client_secret")
    op.drop_column("agencies", "google_oauth_client_id")
