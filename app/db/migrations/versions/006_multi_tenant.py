"""Add multi-tenant support: agencies, users, clients + client_id on all tables

Revision ID: 006
Revises: 005
Create Date: 2026-04-14

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Fixed UUIDs for default records so backfill is deterministic
DEFAULT_AGENCY_ID = "00000000-0000-0000-0000-000000000001"
DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000002"
DEFAULT_CLIENT_ID = "00000000-0000-0000-0000-000000000003"


def upgrade() -> None:
    # 1. Create new tables
    op.create_table(
        "agencies",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("agency_id", sa.Uuid(), sa.ForeignKey("agencies.id"), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("role", sa.String(50), nullable=False, server_default="admin"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_users_agency_id", "users", ["agency_id"])

    op.create_table(
        "clients",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("agency_id", sa.Uuid(), sa.ForeignKey("agencies.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("website_url", sa.String(500), nullable=True),
        sa.Column("logo_url", sa.String(500), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("contact_email", sa.String(255), nullable=True),
        sa.Column("contact_phone", sa.String(50), nullable=True),
        sa.Column("status", sa.String(50), nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_clients_agency_id", "clients", ["agency_id"])
    op.create_index("ix_clients_status", "clients", ["status"])

    # 2. Insert default agency, user, client
    op.execute(
        f"INSERT INTO agencies (id, name) VALUES ('{DEFAULT_AGENCY_ID}', 'Default Agency')"
    )
    op.execute(
        f"INSERT INTO users (id, agency_id, email, name, role) "
        f"VALUES ('{DEFAULT_USER_ID}', '{DEFAULT_AGENCY_ID}', 'admin@agency.local', 'Admin', 'admin')"
    )
    op.execute(
        f"INSERT INTO clients (id, agency_id, name, status) "
        f"VALUES ('{DEFAULT_CLIENT_ID}', '{DEFAULT_AGENCY_ID}', 'Default Client', 'active')"
    )

    # 3. Add nullable client_id / agency_id columns
    for table in ["strategy", "campaigns", "runs", "assets", "feedback", "memory_summaries"]:
        op.add_column(table, sa.Column("client_id", sa.Uuid(), nullable=True))

    op.add_column("task_configs", sa.Column("agency_id", sa.Uuid(), nullable=True))

    # 4. Backfill existing rows
    for table in ["strategy", "campaigns", "runs", "assets", "feedback", "memory_summaries"]:
        op.execute(f"UPDATE {table} SET client_id = '{DEFAULT_CLIENT_ID}' WHERE client_id IS NULL")

    op.execute(f"UPDATE task_configs SET agency_id = '{DEFAULT_AGENCY_ID}' WHERE agency_id IS NULL")

    # 5. Alter to NOT NULL
    for table in ["strategy", "campaigns", "runs", "assets", "feedback", "memory_summaries"]:
        op.alter_column(table, "client_id", nullable=False)

    op.alter_column("task_configs", "agency_id", nullable=False)

    # 6. Add foreign keys and indexes
    for table in ["strategy", "campaigns", "runs", "assets", "feedback", "memory_summaries"]:
        op.create_foreign_key(
            f"fk_{table}_client_id", table, "clients", ["client_id"], ["id"]
        )
        op.create_index(f"ix_{table}_client_id", table, ["client_id"])

    op.create_foreign_key(
        "fk_task_configs_agency_id", "task_configs", "agencies", ["agency_id"], ["id"]
    )
    op.create_index("ix_task_configs_agency_id", "task_configs", ["agency_id"])

    # 7. Unique constraint: one strategy per client
    op.create_unique_constraint("uq_strategy_client_id", "strategy", ["client_id"])


def downgrade() -> None:
    # Remove unique constraint
    op.drop_constraint("uq_strategy_client_id", "strategy", type_="unique")

    # Remove FKs and indexes
    for table in ["strategy", "campaigns", "runs", "assets", "feedback", "memory_summaries"]:
        op.drop_constraint(f"fk_{table}_client_id", table, type_="foreignkey")
        op.drop_index(f"ix_{table}_client_id", table)
        op.drop_column(table, "client_id")

    op.drop_constraint("fk_task_configs_agency_id", "task_configs", type_="foreignkey")
    op.drop_index("ix_task_configs_agency_id", "task_configs")
    op.drop_column("task_configs", "agency_id")

    # Drop new tables (reverse order)
    op.drop_table("clients")
    op.drop_table("users")
    op.drop_table("agencies")
