"""Initial design-agent schema.

Revision ID: 20260721_0001
Revises:
"""
from alembic import op
import sqlalchemy as sa


revision = "20260721_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "design_projects",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("owner_user_id", sa.BigInteger(), nullable=False),
        sa.Column("owner_username", sa.String(160), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_design_projects_owner_user_id", "design_projects", ["owner_user_id"])

    op.create_table(
        "skill_definitions",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("slug", sa.String(80), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("definition_json", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.String(160), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_skill_definitions_slug", "skill_definitions", ["slug"])
    op.create_index("ix_skill_definitions_status", "skill_definitions", ["status"])

    op.create_table(
        "project_briefs",
        sa.Column("project_id", sa.String(80), sa.ForeignKey("design_projects.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
    )
    op.create_table(
        "brand_kits",
        sa.Column("project_id", sa.String(80), sa.ForeignKey("design_projects.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
    )
    op.create_table(
        "brand_assets",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("project_id", sa.String(80), sa.ForeignKey("design_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("asset_library_item_id", sa.String(120), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_brand_assets_project_id", "brand_assets", ["project_id"])

    op.create_table(
        "agent_runs",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("project_id", sa.String(80), sa.ForeignKey("design_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("owner_user_id", sa.BigInteger(), nullable=False),
        sa.Column("owner_username", sa.String(160), nullable=False),
        sa.Column("workflow_id", sa.String(160), nullable=False, unique=True),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("output_type", sa.String(20), nullable=False),
        sa.Column("provider_id", sa.String(80), nullable=False),
        sa.Column("model", sa.String(160), nullable=False),
        sa.Column("size", sa.String(40), nullable=False),
        sa.Column("current_approval_kind", sa.String(32), nullable=False),
        sa.Column("plan_json", sa.JSON(), nullable=False),
        sa.Column("totals_json", sa.JSON(), nullable=False),
        sa.Column("error", sa.Text(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.Column("completed_at", sa.BigInteger(), nullable=True),
    )
    op.create_index("ix_agent_runs_project_id", "agent_runs", ["project_id"])
    op.create_index("ix_agent_runs_owner_user_id", "agent_runs", ["owner_user_id"])
    op.create_index("ix_agent_runs_status", "agent_runs", ["status"])

    op.create_table(
        "agent_steps",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("run_id", sa.String(80), sa.ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("plan_step_id", sa.String(80), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(80), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("capability", sa.String(80), nullable=False),
        sa.Column("dependencies_json", sa.JSON(), nullable=False),
        sa.Column("input_json", sa.JSON(), nullable=False),
        sa.Column("output_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("usage_points", sa.Integer(), nullable=False),
        sa.Column("error", sa.Text(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_agent_steps_run_id", "agent_steps", ["run_id"])
    op.create_index("ix_agent_steps_status", "agent_steps", ["status"])

    op.create_table(
        "approvals",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("run_id", sa.String(80), sa.ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("requested_at", sa.BigInteger(), nullable=False),
        sa.Column("decided_at", sa.BigInteger(), nullable=True),
        sa.Column("decided_by", sa.String(160), nullable=False),
    )
    op.create_index("ix_approvals_run_id", "approvals", ["run_id"])
    op.create_index("ix_approvals_status", "approvals", ["status"])

    op.create_table(
        "generated_assets",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("run_id", sa.String(80), sa.ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step_id", sa.String(80), sa.ForeignKey("agent_steps.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_asset_id", sa.String(80), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(240), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("media_type", sa.String(24), nullable=False),
        sa.Column("model", sa.String(160), nullable=False),
        sa.Column("params_json", sa.JSON(), nullable=False),
        sa.Column("source_activity_key", sa.String(240), nullable=True, unique=True),
        sa.Column("asset_library_item_id", sa.String(120), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_generated_assets_run_id", "generated_assets", ["run_id"])
    op.create_index("ix_generated_assets_step_id", "generated_assets", ["step_id"])

    op.create_table(
        "asset_lineage",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("parent_asset_id", sa.String(80), sa.ForeignKey("generated_assets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("child_asset_id", sa.String(80), sa.ForeignKey("generated_assets.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("relation", sa.String(40), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_asset_lineage_parent_asset_id", "asset_lineage", ["parent_asset_id"])

    op.create_table(
        "quality_reports",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("run_id", sa.String(80), sa.ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step_id", sa.String(80), sa.ForeignKey("agent_steps.id", ondelete="CASCADE"), nullable=False),
        sa.Column("asset_ids_json", sa.JSON(), nullable=False),
        sa.Column("report_json", sa.JSON(), nullable=False),
        sa.Column("source_activity_key", sa.String(240), nullable=True, unique=True),
        sa.Column("passed", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_quality_reports_run_id", "quality_reports", ["run_id"])

    op.create_table(
        "memory_items",
        sa.Column("id", sa.String(80), primary_key=True),
        sa.Column("project_id", sa.String(80), sa.ForeignKey("design_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_type", sa.String(40), nullable=False),
        sa.Column("source_id", sa.String(80), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content_json", sa.JSON(), nullable=False),
        sa.Column("deleted", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("deleted_at", sa.BigInteger(), nullable=True),
    )
    op.create_index("ix_memory_items_project_id", "memory_items", ["project_id"])

    op.create_table(
        "agent_run_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("run_id", sa.String(80), sa.ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step_id", sa.String(80), nullable=False),
        sa.Column("event_type", sa.String(80), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_agent_run_events_run_id", "agent_run_events", ["run_id"])
    op.create_index("ix_agent_run_events_event_type", "agent_run_events", ["event_type"])

    op.create_table(
        "activity_executions",
        sa.Column("idempotency_key", sa.String(240), primary_key=True),
        sa.Column("run_id", sa.String(80), sa.ForeignKey("agent_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step_id", sa.String(80), nullable=False),
        sa.Column("operation", sa.String(80), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("output_json", sa.JSON(), nullable=False),
        sa.Column("usage_event_id", sa.String(80), nullable=False),
        sa.Column("error", sa.Text(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_activity_executions_run_id", "activity_executions", ["run_id"])
    op.create_index("ix_activity_executions_status", "activity_executions", ["status"])


def downgrade() -> None:
    for table_name in (
        "activity_executions", "agent_run_events", "memory_items", "quality_reports",
        "asset_lineage", "generated_assets", "approvals", "agent_steps", "agent_runs",
        "brand_assets", "brand_kits", "project_briefs", "skill_definitions", "design_projects",
    ):
        op.drop_table(table_name)
