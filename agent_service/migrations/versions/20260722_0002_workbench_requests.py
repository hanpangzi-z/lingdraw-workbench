"""Persist Workbench analysis and review requests.

Revision ID: 20260722_0002
Revises: 20260721_0001
"""
from alembic import op
import sqlalchemy as sa


revision = "20260722_0002"
down_revision = "20260721_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workbench_requests",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("owner_user_id", sa.BigInteger(), nullable=False),
        sa.Column("operation", sa.String(80), nullable=False),
        sa.Column("request_id", sa.String(160), nullable=False),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("result_json", sa.JSON(), nullable=False),
        sa.Column("error", sa.Text(), nullable=False),
        sa.Column("provider", sa.String(160), nullable=False),
        sa.Column("model", sa.String(240), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.UniqueConstraint(
            "owner_user_id", "operation", "request_id",
            name="uq_workbench_requests_owner_operation_request",
        ),
    )
    op.create_index("ix_workbench_requests_owner_user_id", "workbench_requests", ["owner_user_id"])
    op.create_index("ix_workbench_requests_status", "workbench_requests", ["status"])


def downgrade() -> None:
    op.drop_table("workbench_requests")
