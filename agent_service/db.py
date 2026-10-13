from __future__ import annotations

import os
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, delete, select, update, event
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from .domain import (
    AgentRunStatus,
    AgentStepStatus,
    ApprovalKind,
    ApprovalStatus,
    OutputType,
    SkillStatus,
    new_id,
    now_ms,
)

Text = Text().with_variant(LONGTEXT(), 'mysql')


class AgentStoreError(Exception):
    def __init__(self, message: str, code: str = "agent_store_error", status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.code = code
        self.status_code = status_code


class Base(DeclarativeBase):
    pass


class DesignProject(Base):
    __tablename__ = "design_projects"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    owner_user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    owner_username: Mapped[str] = mapped_column(String(160))
    name: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(32), default="active")
    created_at: Mapped[int] = mapped_column(BigInteger)
    updated_at: Mapped[int] = mapped_column(BigInteger)


class ProjectBrief(Base):
    __tablename__ = "project_briefs"
    project_id: Mapped[str] = mapped_column(String(80), ForeignKey("design_projects.id", ondelete="CASCADE"), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[int] = mapped_column(BigInteger)


class BrandKit(Base):
    __tablename__ = "brand_kits"
    project_id: Mapped[str] = mapped_column(String(80), ForeignKey("design_projects.id", ondelete="CASCADE"), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[int] = mapped_column(BigInteger)


class BrandAsset(Base):
    __tablename__ = "brand_assets"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(80), ForeignKey("design_projects.id", ondelete="CASCADE"), index=True)
    asset_library_item_id: Mapped[str] = mapped_column(String(120), default="")
    url: Mapped[str] = mapped_column(Text, default="")
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[int] = mapped_column(BigInteger)


class AgentRun(Base):
    __tablename__ = "agent_runs"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(80), ForeignKey("design_projects.id", ondelete="CASCADE"), index=True)
    owner_user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    owner_username: Mapped[str] = mapped_column(String(160))
    workflow_id: Mapped[str] = mapped_column(String(160), unique=True)
    status: Mapped[str] = mapped_column(String(32), index=True)
    output_type: Mapped[str] = mapped_column(String(20))
    provider_id: Mapped[str] = mapped_column(String(80), default="comfly")
    model: Mapped[str] = mapped_column(String(160), default="")
    size: Mapped[str] = mapped_column(String(40), default="1024x1024")
    current_approval_kind: Mapped[str] = mapped_column(String(32), default="")
    plan_json: Mapped[dict] = mapped_column(JSON, default=dict)
    totals_json: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[int] = mapped_column(BigInteger)
    updated_at: Mapped[int] = mapped_column(BigInteger)
    completed_at: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)


class AgentStep(Base):
    __tablename__ = "agent_steps"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(80), ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True)
    plan_step_id: Mapped[str] = mapped_column(String(80))
    position: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(String(160))
    capability: Mapped[str] = mapped_column(String(80))
    dependencies_json: Mapped[list] = mapped_column(JSON, default=list)
    input_json: Mapped[dict] = mapped_column(JSON, default=dict)
    output_json: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(32), index=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    usage_points: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[int] = mapped_column(BigInteger)
    updated_at: Mapped[int] = mapped_column(BigInteger)


class Approval(Base):
    __tablename__ = "approvals"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(80), ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32), index=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    requested_at: Mapped[int] = mapped_column(BigInteger)
    decided_at: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    decided_by: Mapped[str] = mapped_column(String(160), default="")


class GeneratedAsset(Base):
    __tablename__ = "generated_assets"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(80), ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True)
    step_id: Mapped[str] = mapped_column(String(80), ForeignKey("agent_steps.id", ondelete="CASCADE"), index=True)
    parent_asset_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    name: Mapped[str] = mapped_column(String(240), default="")
    url: Mapped[str] = mapped_column(Text)
    media_type: Mapped[str] = mapped_column(String(24), default="image")
    model: Mapped[str] = mapped_column(String(160), default="")
    params_json: Mapped[dict] = mapped_column(JSON, default=dict)
    source_activity_key: Mapped[Optional[str]] = mapped_column(String(240), nullable=True, unique=True)
    asset_library_item_id: Mapped[str] = mapped_column(String(120), default="")
    created_at: Mapped[int] = mapped_column(BigInteger)


class AssetLineage(Base):
    __tablename__ = "asset_lineage"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    parent_asset_id: Mapped[str] = mapped_column(String(80), ForeignKey("generated_assets.id", ondelete="CASCADE"), index=True)
    child_asset_id: Mapped[str] = mapped_column(String(80), ForeignKey("generated_assets.id", ondelete="CASCADE"), unique=True)
    relation: Mapped[str] = mapped_column(String(40), default="revision")
    created_at: Mapped[int] = mapped_column(BigInteger)


class QualityReport(Base):
    __tablename__ = "quality_reports"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(80), ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True)
    step_id: Mapped[str] = mapped_column(String(80), ForeignKey("agent_steps.id", ondelete="CASCADE"))
    asset_ids_json: Mapped[list] = mapped_column(JSON, default=list)
    report_json: Mapped[dict] = mapped_column(JSON, default=dict)
    source_activity_key: Mapped[Optional[str]] = mapped_column(String(240), nullable=True, unique=True)
    passed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(BigInteger)


class MemoryItem(Base):
    __tablename__ = "memory_items"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(80), ForeignKey("design_projects.id", ondelete="CASCADE"), index=True)
    source_type: Mapped[str] = mapped_column(String(40))
    source_id: Mapped[str] = mapped_column(String(80))
    version: Mapped[int] = mapped_column(Integer, default=1)
    content_json: Mapped[dict] = mapped_column(JSON, default=dict)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(BigInteger)
    deleted_at: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)


class SkillDefinition(Base):
    __tablename__ = "skill_definitions"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    slug: Mapped[str] = mapped_column(String(80), index=True)
    name: Mapped[str] = mapped_column(String(120))
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(32), index=True)
    definition_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_by: Mapped[str] = mapped_column(String(160))
    created_at: Mapped[int] = mapped_column(BigInteger)
    updated_at: Mapped[int] = mapped_column(BigInteger)


class AgentRunEvent(Base):
    __tablename__ = "agent_run_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(80), ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True)
    step_id: Mapped[str] = mapped_column(String(80), default="")
    event_type: Mapped[str] = mapped_column(String(80), index=True)
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[int] = mapped_column(BigInteger)


class ActivityExecution(Base):
    __tablename__ = "activity_executions"
    idempotency_key: Mapped[str] = mapped_column(String(240), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(80), ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True)
    step_id: Mapped[str] = mapped_column(String(80), default="")
    operation: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(32), index=True)
    output_json: Mapped[dict] = mapped_column(JSON, default=dict)
    usage_event_id: Mapped[str] = mapped_column(String(80), default="")
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[int] = mapped_column(BigInteger)
    updated_at: Mapped[int] = mapped_column(BigInteger)


class WorkbenchRequest(Base):
    __tablename__ = "workbench_requests"
    __table_args__ = (
        UniqueConstraint(
            "owner_user_id", "operation", "request_id",
            name="uq_workbench_requests_owner_operation_request",
        ),
    )
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    owner_user_id: Mapped[int] = mapped_column(BigInteger, index=True)
    operation: Mapped[str] = mapped_column(String(80))
    request_id: Mapped[str] = mapped_column(String(160))
    fingerprint: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), index=True)
    result_json: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str] = mapped_column(Text, default="")
    provider: Mapped[str] = mapped_column(String(160), default="")
    model: Mapped[str] = mapped_column(String(240), default="")
    created_at: Mapped[int] = mapped_column(BigInteger)
    updated_at: Mapped[int] = mapped_column(BigInteger)


def model_dict(row: Any) -> Dict[str, Any]:
    return {column.name: getattr(row, column.name) for column in row.__table__.columns}


class AgentStore:
    def __init__(self, database_url: str, auto_create: bool = False):
        self.database_url = database_url
        self.engine = create_async_engine(database_url, pool_pre_ping=True, pool_recycle=1800, hide_parameters=True)
        if self.engine.dialect.name == 'mysql':
            @event.listens_for(self.engine.sync_engine, 'connect')
            def configure(connection, _):
                cursor=connection.cursor()
                try:
                    cursor.execute("SET time_zone = '+00:00'")
                    cursor.execute("SELECT VERSION()")
                    if not str(cursor.fetchone()[0]).startswith('8.0.'):
                        raise RuntimeError('Agent requires MySQL 8.0.x')
                finally: cursor.close()
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        self.auto_create = auto_create

    async def initialize(self):
        if self.auto_create:
            async with self.engine.begin() as connection:
                await connection.run_sync(Base.metadata.create_all)
        await self.seed_skills()

    async def close(self):
        await self.engine.dispose()

    async def health(self):
        async with self.engine.connect() as connection:
            await connection.execute(select(1))

    async def get_workbench_request(
        self,
        owner_user_id: int,
        operation: str,
        request_id: str,
    ) -> Optional[Dict[str, Any]]:
        async with self.sessions() as session:
            row = await session.scalar(select(WorkbenchRequest).where(
                WorkbenchRequest.owner_user_id == owner_user_id,
                WorkbenchRequest.operation == operation,
                WorkbenchRequest.request_id == request_id,
            ))
            return model_dict(row) if row is not None else None

    async def claim_workbench_request(self, owner_user_id: int, operation: str, request_id: str,
                                      fingerprint: str, provider: str, model: str,
                                      executor_id: str = "", running_fresh_ms: int = 300_000) -> Dict[str, Any]:
        """Claim one Workbench model call, replaying or rejecting an existing claim."""
        key_filter = (
            WorkbenchRequest.owner_user_id == owner_user_id,
            WorkbenchRequest.operation == operation,
            WorkbenchRequest.request_id == request_id,
        )
        for _ in range(3):
            ts = now_ms()
            claim_token = new_id("workbench-claim")
            lease = {"_executor_id": executor_id, "_claim_token": claim_token}
            async with self.sessions() as session:
                row = await session.scalar(select(WorkbenchRequest).where(*key_filter))
                if row is None:
                    row = WorkbenchRequest(
                        id=new_id("workbench"), owner_user_id=owner_user_id,
                        operation=operation, request_id=request_id, fingerprint=fingerprint,
                        status="running", result_json=lease, error="", provider=provider,
                        model=model, created_at=ts, updated_at=ts,
                    )
                    session.add(row)
                    try:
                        await session.commit()
                    except IntegrityError:
                        await session.rollback()
                        continue
                    return {"action": "execute", "request": model_dict(row)}

                if row.fingerprint != fingerprint:
                    raise AgentStoreError(
                        "同一请求 ID 不能用于不同的 Workbench 输入",
                        "workbench_request_conflict",
                        409,
                    )
                if row.status == "succeeded":
                    return {"action": "replay", "request": model_dict(row)}
                running_lease = dict(row.result_json or {})
                if row.status == "running" and ts - row.updated_at < running_fresh_ms:
                    raise AgentStoreError(
                        "Workbench 请求正在执行",
                        "workbench_request_in_progress",
                        409,
                    )

                previous_status = row.status
                previous_updated_at = row.updated_at
                claimed_at = max(ts, previous_updated_at + 1)
                claimed = await session.execute(
                    update(WorkbenchRequest)
                    .where(*key_filter)
                    .where(WorkbenchRequest.status == previous_status)
                    .where(WorkbenchRequest.updated_at == previous_updated_at)
                    .values(
                        status="running", result_json=lease, error="", provider=provider,
                        model=model, updated_at=claimed_at,
                    )
                )
                if claimed.rowcount != 1:
                    await session.rollback()
                    continue
                await session.commit()
                current = await session.scalar(select(WorkbenchRequest).where(*key_filter))
                return {"action": "execute", "request": model_dict(current)}
        raise AgentStoreError("Workbench 请求状态发生并发更新", "workbench_request_in_progress", 409)

    async def heartbeat_workbench_request(self, owner_user_id: int, operation: str, request_id: str,
                                          fingerprint: str, claim_token: str) -> bool:
        """Extend a running lease only while the caller still owns its CAS token."""
        async with self.sessions() as session:
            row = await session.scalar(select(WorkbenchRequest).where(
                WorkbenchRequest.owner_user_id == owner_user_id,
                WorkbenchRequest.operation == operation,
                WorkbenchRequest.request_id == request_id,
            ))
            if row is None or row.fingerprint != fingerprint or row.status != "running":
                return False
            current_claim = str((row.result_json or {}).get("_claim_token") or "")
            if not claim_token or current_claim != claim_token:
                return False
            expected_updated_at = row.updated_at
            heartbeat_at = max(now_ms(), expected_updated_at + 1)
            updated = await session.execute(
                update(WorkbenchRequest)
                .where(WorkbenchRequest.id == row.id)
                .where(WorkbenchRequest.status == "running")
                .where(WorkbenchRequest.updated_at == expected_updated_at)
                .values(updated_at=heartbeat_at)
            )
            if updated.rowcount != 1:
                await session.rollback()
                return False
            await session.commit()
            return True

    async def finish_workbench_request(self, owner_user_id: int, operation: str, request_id: str,
                                       fingerprint: str, status: str, result: Optional[Dict[str, Any]] = None,
                                       error: str = "", claim_token: str = "") -> Dict[str, Any]:
        async with self.sessions() as session:
            row = await session.scalar(select(WorkbenchRequest).where(
                WorkbenchRequest.owner_user_id == owner_user_id,
                WorkbenchRequest.operation == operation,
                WorkbenchRequest.request_id == request_id,
            ))
            if row is None:
                raise AgentStoreError("Workbench 请求不存在", "workbench_request_not_found", 404)
            if row.fingerprint != fingerprint:
                raise AgentStoreError(
                    "同一请求 ID 不能用于不同的 Workbench 输入",
                    "workbench_request_conflict",
                    409,
                )
            current_claim = str((row.result_json or {}).get("_claim_token") or "")
            if claim_token and current_claim != claim_token:
                raise AgentStoreError(
                    "Workbench 请求已由新的执行租约接管",
                    "workbench_request_lease_lost",
                    409,
                )
            if row.status == "succeeded":
                return model_dict(row)
            if row.status != "running":
                raise AgentStoreError(
                    "Workbench 请求已不属于当前执行租约",
                    "workbench_request_lease_lost",
                    409,
                )
            expected_updated_at = row.updated_at
            result_payload = dict(result or {})
            if claim_token:
                result_payload["_claim_token"] = claim_token
            finished_at = max(now_ms(), expected_updated_at + 1)
            updated = await session.execute(
                update(WorkbenchRequest)
                .where(WorkbenchRequest.id == row.id)
                .where(WorkbenchRequest.status == "running")
                .where(WorkbenchRequest.updated_at == expected_updated_at)
                .values(
                    status=status,
                    result_json=result_payload,
                    error=error,
                    updated_at=finished_at,
                )
            )
            if updated.rowcount != 1:
                await session.rollback()
                current = await session.scalar(select(WorkbenchRequest).where(WorkbenchRequest.id == row.id))
                current_claim = str(((current.result_json if current else {}) or {}).get("_claim_token") or "")
                if current is not None and current.status == "succeeded" and current_claim == claim_token:
                    return model_dict(current)
                raise AgentStoreError(
                    "Workbench 请求已由新的执行租约接管",
                    "workbench_request_lease_lost",
                    409,
                )
            await session.commit()
            current = await session.scalar(select(WorkbenchRequest).where(WorkbenchRequest.id == row.id))
            return model_dict(current)

    async def update_workbench_result(self, owner_user_id: int, operation: str, request_id: str,
                                      fingerprint: str, result_patch: Dict[str, Any],
                                      claim_token: str = "") -> Dict[str, Any]:
        async with self.sessions() as session:
            row = await session.scalar(select(WorkbenchRequest).where(
                WorkbenchRequest.owner_user_id == owner_user_id,
                WorkbenchRequest.operation == operation,
                WorkbenchRequest.request_id == request_id,
            ))
            if row is None:
                raise AgentStoreError("Workbench 请求不存在", "workbench_request_not_found", 404)
            if row.fingerprint != fingerprint:
                raise AgentStoreError(
                    "同一请求 ID 不能用于不同的 Workbench 输入",
                    "workbench_request_conflict",
                    409,
                )
            if row.status != "succeeded":
                raise AgentStoreError("Workbench 请求尚未完成", "workbench_request_in_progress", 409)
            current_result = dict(row.result_json or {})
            current_claim = str(current_result.get("_claim_token") or "")
            if claim_token and current_claim != claim_token:
                raise AgentStoreError(
                    "Workbench 请求已由新的执行租约接管",
                    "workbench_request_lease_lost",
                    409,
                )
            expected_updated_at = row.updated_at
            for key, value in result_patch.items():
                if key in {"charged_points", "billing_pending"}:
                    if key == "billing_pending" and not value:
                        current_result.pop(key, None)
                    else:
                        current_result[key] = value
            patched_at = max(now_ms(), expected_updated_at + 1)
            updated = await session.execute(
                update(WorkbenchRequest)
                .where(WorkbenchRequest.id == row.id)
                .where(WorkbenchRequest.status == "succeeded")
                .where(WorkbenchRequest.updated_at == expected_updated_at)
                .values(result_json=current_result, updated_at=patched_at)
            )
            if updated.rowcount != 1:
                await session.rollback()
                raise AgentStoreError(
                    "Workbench 结果已被并发更新",
                    "workbench_request_lease_lost",
                    409,
                )
            await session.commit()
            current = await session.scalar(select(WorkbenchRequest).where(WorkbenchRequest.id == row.id))
            return model_dict(current)

    async def pending_workbench_billing(self, limit: int = 1000) -> List[Dict[str, Any]]:
        """Return durable successful results whose usage settlement still needs repair."""
        async with self.sessions() as session:
            rows = (await session.scalars(
                select(WorkbenchRequest)
                .where(WorkbenchRequest.status == "succeeded")
                .where(WorkbenchRequest.result_json["billing_pending"].as_boolean() == True)  # noqa: E712
                .order_by(WorkbenchRequest.updated_at.asc())
                .limit(max(1, min(int(limit or 1000), 1000)))
            )).all()
        return [
            model_dict(row)
            for row in rows
            if bool((row.result_json or {}).get("billing_pending"))
            and bool((row.result_json or {}).get("_usage_event_id"))
        ]

    async def seed_skills(self):
        defaults = [
            ("creative-director", "Creative Director"),
            ("art-director", "Art Director"),
            ("product-detail-page", "商品详情页"),
            ("product-fidelity", "Product Fidelity"),
            ("quality-critic", "Quality Critic"),
        ]
        async with self.sessions() as session:
            existing = set((await session.scalars(select(SkillDefinition.slug))).all())
            ts = now_ms()
            for slug, name in defaults:
                if slug not in existing:
                    definition = {"role": name, "output_schema_version": 1}
                    if slug == "product-detail-page":
                        definition = {
                            "role": "通用商品详情页多模块设计子 Agent",
                            "output_schema_version": 2,
                            "workflow_type": "multi_artifact",
                            "workflow_version": 1,
                            "module_limits": {"min": 4, "max": 12},
                            "planning": {"dynamic_modules": True, "requires_confirmation": True},
                            "generation": {"default_count_per_module": 1, "stable_module_request_ids": True},
                            "review": {
                                "per_module": True,
                                "criteria": ["产品一致性", "文字与卖点", "视觉连续性", "交付规格"],
                                "automatic_regeneration": False,
                            },
                        }
                    session.add(SkillDefinition(
                        id=new_id("skill"), slug=slug, name=name, version=1,
                        status=SkillStatus.published.value,
                        definition_json=definition,
                        created_by="system", created_at=ts, updated_at=ts,
                    ))
            await session.commit()

    async def create_project(self, owner_user_id: int, owner_username: str, name: str) -> Dict[str, Any]:
        ts = now_ms()
        row = DesignProject(id=new_id("project"), owner_user_id=owner_user_id, owner_username=owner_username,
                            name=name.strip()[:120], status="active", created_at=ts, updated_at=ts)
        async with self.sessions() as session:
            session.add(row)
            await session.commit()
        return model_dict(row)

    async def list_projects(self, owner_user_id: int) -> List[Dict[str, Any]]:
        async with self.sessions() as session:
            rows = (await session.scalars(
                select(DesignProject).where(DesignProject.owner_user_id == owner_user_id).order_by(DesignProject.updated_at.desc())
            )).all()
            return [model_dict(row) for row in rows]

    async def get_project(self, project_id: str, owner_user_id: int) -> DesignProject:
        async with self.sessions() as session:
            row = await session.scalar(select(DesignProject).where(
                DesignProject.id == project_id, DesignProject.owner_user_id == owner_user_id
            ))
            if not row:
                raise AgentStoreError("设计项目不存在", "project_not_found", 404)
            return row

    async def project_bundle(self, project_id: str, owner_user_id: int) -> Dict[str, Any]:
        async with self.sessions() as session:
            project = await session.scalar(select(DesignProject).where(
                DesignProject.id == project_id, DesignProject.owner_user_id == owner_user_id
            ))
            if not project:
                raise AgentStoreError("设计项目不存在", "project_not_found", 404)
            brief = await session.get(ProjectBrief, project_id)
            brand = await session.get(BrandKit, project_id)
            runs = (await session.scalars(select(AgentRun).where(AgentRun.project_id == project_id).order_by(AgentRun.created_at.desc()))).all()
            return {
                "project": model_dict(project),
                "brief": model_dict(brief) if brief else None,
                "brand_kit": model_dict(brand) if brand else None,
                "runs": [model_dict(row) for row in runs],
            }

    async def save_document(self, model, project_id: str, owner_user_id: int, version: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        async with self.sessions() as session:
            project = await session.scalar(select(DesignProject).where(
                DesignProject.id == project_id, DesignProject.owner_user_id == owner_user_id
            ))
            if not project:
                raise AgentStoreError("设计项目不存在", "project_not_found", 404)
            row = await session.get(model, project_id, with_for_update=True)
            current_version = int(row.version if row else 0)
            if int(version) != current_version:
                raise AgentStoreError("内容已被更新，请刷新后重试", "version_conflict", 409)
            ts = now_ms()
            if row:
                row.version += 1
                row.payload = payload
                row.updated_at = ts
            else:
                row = model(project_id=project_id, version=1, payload=payload, updated_at=ts)
                session.add(row)
            project.updated_at = ts
            await session.commit()
            return model_dict(row)

    async def create_run(self, project_id: str, owner_user_id: int, owner_username: str,
                         output_type: str, provider_id: str, model: str, size: str) -> Dict[str, Any]:
        await self.get_project(project_id, owner_user_id)
        ts = now_ms()
        run_id = new_id("run")
        row = AgentRun(
            id=run_id, project_id=project_id, owner_user_id=owner_user_id, owner_username=owner_username,
            workflow_id=f"design-run-{run_id}", status=AgentRunStatus.planning.value,
            output_type=output_type, provider_id=provider_id, model=model, size=size,
            current_approval_kind="", plan_json={}, totals_json={"points": 0, "assets": 0}, error="",
            created_at=ts, updated_at=ts,
        )
        async with self.sessions() as session:
            session.add(row)
            await session.commit()
        await self.append_event(run_id, "run.created", {"status": row.status})
        return model_dict(row)

    async def run_owned(self, run_id: str, owner_user_id: int) -> AgentRun:
        async with self.sessions() as session:
            row = await session.scalar(select(AgentRun).where(AgentRun.id == run_id, AgentRun.owner_user_id == owner_user_id))
            if not row:
                raise AgentStoreError("运行记录不存在", "run_not_found", 404)
            return row

    async def run(self, run_id: str) -> AgentRun:
        async with self.sessions() as session:
            row = await session.get(AgentRun, run_id)
            if not row:
                raise AgentStoreError("运行记录不存在", "run_not_found", 404)
            return row

    async def replace_plan(self, run_id: str, plan: Dict[str, Any]) -> Dict[str, Any]:
        async with self.sessions() as session:
            row = await session.get(AgentRun, run_id, with_for_update=True)
            if not row:
                raise AgentStoreError("运行记录不存在", "run_not_found", 404)
            await session.execute(delete(AgentStep).where(AgentStep.run_id == run_id))
            ts = now_ms()
            for position, step in enumerate(plan.get("steps") or []):
                session.add(AgentStep(
                    id=new_id("step"), run_id=run_id, plan_step_id=step["id"], position=position,
                    role=step["role"], title=step["title"], capability=step.get("capability") or "image",
                    dependencies_json=step.get("depends_on") or [], input_json={"instruction": step.get("instruction") or ""},
                    output_json={}, status=AgentStepStatus.pending.value, attempt_count=0, usage_points=0,
                    error="", created_at=ts, updated_at=ts,
                ))
            approval = Approval(id=new_id("approval"), run_id=run_id, kind=ApprovalKind.plan.value,
                                status=ApprovalStatus.pending.value, reason="", requested_at=ts,
                                decided_at=None, decided_by="")
            session.add(approval)
            row.plan_json = plan
            row.status = AgentRunStatus.awaiting_approval.value
            row.current_approval_kind = ApprovalKind.plan.value
            row.updated_at = ts
            await session.commit()
            result = model_dict(row)
            result["approval_id"] = approval.id
        await self.append_event(run_id, "plan.ready", {"approval_id": approval.id, "plan": plan})
        return result

    async def transition(self, run_id: str, status: str, approval_kind: str = "", error: str = "") -> Dict[str, Any]:
        async with self.sessions() as session:
            row = await session.get(AgentRun, run_id, with_for_update=True)
            if not row:
                raise AgentStoreError("运行记录不存在", "run_not_found", 404)
            row.status = status
            row.current_approval_kind = approval_kind
            row.error = str(error or "")[:4000]
            row.updated_at = now_ms()
            if status in {AgentRunStatus.succeeded.value, AgentRunStatus.failed.value, AgentRunStatus.cancelled.value}:
                row.completed_at = row.updated_at
            await session.commit()
            result = model_dict(row)
        await self.append_event(run_id, "run.status", {"status": status, "approval_kind": approval_kind, "error": error})
        return result

    async def pending_approval(self, run_id: str, approval_id: str = "") -> Approval:
        async with self.sessions() as session:
            query = select(Approval).where(Approval.run_id == run_id, Approval.status == ApprovalStatus.pending.value)
            if approval_id:
                query = query.where(Approval.id == approval_id)
            row = await session.scalar(query.order_by(Approval.requested_at.desc()))
            if not row:
                raise AgentStoreError("没有待处理的审批", "approval_not_found", 409)
            return row

    async def decide_approval(self, run_id: str, approval_id: str, approved: bool, username: str, reason: str) -> Dict[str, Any]:
        async with self.sessions() as session:
            row = await session.scalar(select(Approval).where(
                Approval.id == approval_id, Approval.run_id == run_id,
                Approval.status == ApprovalStatus.pending.value,
            ).with_for_update())
            if not row:
                raise AgentStoreError("审批已处理或不存在", "approval_not_found", 409)
            row.status = ApprovalStatus.approved.value if approved else ApprovalStatus.rejected.value
            row.reason = str(reason or "")[:1000]
            row.decided_by = username
            row.decided_at = now_ms()
            await session.commit()
            result = model_dict(row)
        await self.append_event(run_id, "approval.decided", result)
        return result

    async def create_approval(self, run_id: str, kind: str) -> Dict[str, Any]:
        ts = now_ms()
        row = Approval(id=new_id("approval"), run_id=run_id, kind=kind, status=ApprovalStatus.pending.value,
                       reason="", requested_at=ts, decided_at=None, decided_by="")
        async with self.sessions() as session:
            session.add(row)
            run = await session.get(AgentRun, run_id, with_for_update=True)
            run.status = AgentRunStatus.awaiting_approval.value
            run.current_approval_kind = kind
            run.updated_at = ts
            await session.commit()
        await self.append_event(run_id, "approval.requested", {"approval_id": row.id, "kind": kind})
        return model_dict(row)

    async def steps(self, run_id: str) -> List[Dict[str, Any]]:
        async with self.sessions() as session:
            rows = (await session.scalars(select(AgentStep).where(AgentStep.run_id == run_id).order_by(AgentStep.position))).all()
            return [model_dict(row) for row in rows]

    async def mark_step(self, step_id: str, status: str, output: Optional[Dict[str, Any]] = None,
                        error: str = "", increment_attempt: bool = False, usage_points: int = 0) -> Dict[str, Any]:
        async with self.sessions() as session:
            row = await session.get(AgentStep, step_id, with_for_update=True)
            if not row:
                raise AgentStoreError("步骤不存在", "step_not_found", 404)
            row.status = status
            if output is not None:
                row.output_json = output
            row.error = str(error or "")[:4000]
            if increment_attempt:
                row.attempt_count += 1
            row.usage_points += max(0, int(usage_points or 0))
            row.updated_at = now_ms()
            await session.commit()
            result = model_dict(row)
        await self.append_event(row.run_id, "step.status", {"step": result}, step_id=row.id)
        return result

    async def cancel_unfinished_steps(self, run_id: str) -> None:
        async with self.sessions() as session:
            rows = (await session.scalars(select(AgentStep).where(
                AgentStep.run_id == run_id,
                AgentStep.status.in_([AgentStepStatus.pending.value, AgentStepStatus.running.value]),
            ).with_for_update())).all()
            ts = now_ms()
            for row in rows:
                row.status = AgentStepStatus.cancelled.value
                row.updated_at = ts
            await session.commit()
        if rows:
            await self.append_event(run_id, "steps.cancelled", {"step_ids": [row.id for row in rows]})

    async def add_asset(self, run_id: str, step_id: str, url: str, name: str, model: str,
                        params: Dict[str, Any], parent_asset_id: Optional[str] = None,
                        source_activity_key: Optional[str] = None) -> Dict[str, Any]:
        version = 1
        async with self.sessions() as session:
            run = await session.get(AgentRun, run_id, with_for_update=True)
            if not run: raise AgentStoreError('任务不存在','run_not_found',404)
            if source_activity_key:
                existing = await session.scalar(select(GeneratedAsset).where(
                    GeneratedAsset.source_activity_key == source_activity_key
                ))
                if existing:
                    return model_dict(existing)
            if parent_asset_id:
                parent = await session.get(GeneratedAsset, parent_asset_id)
                if not parent or parent.run_id != run_id:
                    raise AgentStoreError("父资产不存在", "asset_not_found", 404)
                version = parent.version + 1
            row = GeneratedAsset(
                id=new_id("asset"), run_id=run_id, step_id=step_id, parent_asset_id=parent_asset_id,
                version=version, name=name[:240], url=url, media_type="image", model=model[:160],
                params_json=params or {}, source_activity_key=source_activity_key,
                asset_library_item_id="", created_at=now_ms(),
            )
            session.add(row)
            # SQLAlchemy has no ORM relationship here to order the inserts.
            # InnoDB checks the child reference immediately, unlike old SQLite.
            await session.flush()
            if parent_asset_id:
                session.add(AssetLineage(id=new_id("lineage"), parent_asset_id=parent_asset_id,
                                         child_asset_id=row.id, relation="revision", created_at=now_ms()))
            totals = dict(run.totals_json or {})
            totals["assets"] = int(totals.get("assets") or 0) + 1
            run.totals_json = totals
            run.updated_at = now_ms()
            await session.commit()
            result = model_dict(row)
        await self.append_event(run_id, "asset.created", {"asset": result}, step_id=step_id)
        return result

    async def add_quality_report(self, run_id: str, step_id: str, asset_ids: List[str], report: Dict[str, Any],
                                 source_activity_key: Optional[str] = None) -> Dict[str, Any]:
        row = QualityReport(id=new_id("quality"), run_id=run_id, step_id=step_id, asset_ids_json=asset_ids,
                            report_json=report, source_activity_key=source_activity_key,
                            passed=bool(report.get("passed")), created_at=now_ms())
        async with self.sessions() as session:
            run = await session.get(AgentRun, run_id, with_for_update=True)
            if not run: raise AgentStoreError('任务不存在','run_not_found',404)
            if source_activity_key:
                existing = await session.scalar(select(QualityReport).where(
                    QualityReport.source_activity_key == source_activity_key
                ))
                if existing:
                    return model_dict(existing)
            session.add(row)
            await session.commit()
        result = model_dict(row)
        await self.append_event(run_id, "quality.completed", {"quality_report": result}, step_id=step_id)
        return result

    async def assets(self, run_id: str, asset_ids: Optional[Iterable[str]] = None) -> List[Dict[str, Any]]:
        async with self.sessions() as session:
            query = select(GeneratedAsset).where(GeneratedAsset.run_id == run_id)
            if asset_ids is not None:
                ids = list(asset_ids)
                query = query.where(GeneratedAsset.id.in_(ids))
            rows = (await session.scalars(query.order_by(GeneratedAsset.created_at))).all()
            return [model_dict(row) for row in rows]

    async def mark_assets_published(self, run_id: str, mapping: Dict[str, str]):
        async with self.sessions() as session:
            rows = (await session.scalars(select(GeneratedAsset).where(
                GeneratedAsset.run_id == run_id, GeneratedAsset.id.in_(list(mapping))
            ))).all()
            for row in rows:
                row.asset_library_item_id = mapping.get(row.id, "")
            await session.commit()

    async def quality_reports(self, run_id: str) -> List[Dict[str, Any]]:
        async with self.sessions() as session:
            rows = (await session.scalars(select(QualityReport).where(QualityReport.run_id == run_id).order_by(QualityReport.created_at))).all()
            return [model_dict(row) for row in rows]

    async def approvals(self, run_id: str) -> List[Dict[str, Any]]:
        async with self.sessions() as session:
            rows = (await session.scalars(select(Approval).where(Approval.run_id == run_id).order_by(Approval.requested_at))).all()
            return [model_dict(row) for row in rows]

    async def snapshot(self, run_id: str, owner_user_id: int) -> Dict[str, Any]:
        run = await self.run_owned(run_id, owner_user_id)
        return {
            "run": model_dict(run),
            "steps": await self.steps(run_id),
            "approvals": await self.approvals(run_id),
            "assets": await self.assets(run_id),
            "quality_reports": await self.quality_reports(run_id),
        }

    async def append_event(self, run_id: str, event_type: str, payload: Dict[str, Any], step_id: str = "") -> Dict[str, Any]:
        row = AgentRunEvent(run_id=run_id, step_id=step_id, event_type=event_type,
                            payload_json=payload or {}, created_at=now_ms())
        async with self.sessions() as session:
            session.add(row)
            await session.commit()
            await session.refresh(row)
        return model_dict(row)

    async def events_after(self, run_id: str, after_id: int, limit: int = 200) -> List[Dict[str, Any]]:
        async with self.sessions() as session:
            rows = (await session.scalars(select(AgentRunEvent).where(
                AgentRunEvent.run_id == run_id, AgentRunEvent.id > max(0, int(after_id or 0))
            ).order_by(AgentRunEvent.id).limit(limit))).all()
            return [model_dict(row) for row in rows]

    async def activity(self, key: str) -> Optional[Dict[str, Any]]:
        async with self.sessions() as session:
            row = await session.get(ActivityExecution, key)
            return model_dict(row) if row else None

    async def start_activity(self, key: str, run_id: str, step_id: str, operation: str) -> Dict[str, Any]:
        async with self.sessions() as session:
            row = await session.get(ActivityExecution, key, with_for_update=True)
            if not row:
                ts = now_ms()
                row = ActivityExecution(idempotency_key=key, run_id=run_id, step_id=step_id,
                                        operation=operation, status="running", output_json={}, usage_event_id="",
                                        error="", created_at=ts, updated_at=ts)
                session.add(row)
            await session.commit()
            return model_dict(row)

    async def finish_activity(self, key: str, status: str, output: Dict[str, Any], usage_event_id: str = "", error: str = ""):
        async with self.sessions() as session:
            row = await session.get(ActivityExecution, key, with_for_update=True)
            if not row:
                raise AgentStoreError("Activity 不存在", "activity_not_found", 404)
            first_success = status == "succeeded" and row.status != "succeeded"
            row.status = status
            row.output_json = output or {}
            row.usage_event_id = usage_event_id
            row.error = str(error or "")[:4000]
            row.updated_at = now_ms()
            if first_success:
                run = await session.get(AgentRun, row.run_id, with_for_update=True)
                charged_points = max(0, int((output or {}).get("_charged_points") or 0))
                if run:
                    totals = dict(run.totals_json or {})
                    totals["points"] = int(totals.get("points") or 0) + charged_points
                    run.totals_json = totals
                    run.updated_at = now_ms()
                if row.step_id:
                    step = await session.get(AgentStep, row.step_id, with_for_update=True)
                    if step:
                        step.usage_points += charged_points
                        step.updated_at = now_ms()
            await session.commit()

    async def list_skills(self, published_only: bool = True) -> List[Dict[str, Any]]:
        async with self.sessions() as session:
            query = select(SkillDefinition)
            if published_only:
                query = query.where(SkillDefinition.status == SkillStatus.published.value)
            rows = (await session.scalars(query.order_by(SkillDefinition.slug, SkillDefinition.version.desc()))).all()
            return [model_dict(row) for row in rows]

    async def create_skill(self, slug: str, name: str, definition: Dict[str, Any], username: str) -> Dict[str, Any]:
        async with self.sessions() as session:
            latest = await session.scalar(select(SkillDefinition).where(SkillDefinition.slug == slug).order_by(SkillDefinition.version.desc()))
            version = int(latest.version if latest else 0) + 1
            ts = now_ms()
            row = SkillDefinition(id=new_id("skill"), slug=slug, name=name, version=version,
                                  status=SkillStatus.draft.value, definition_json=definition,
                                  created_by=username, created_at=ts, updated_at=ts)
            session.add(row)
            await session.commit()
            return model_dict(row)

    async def skill_action(self, skill_id: str, action: str) -> Dict[str, Any]:
        target = {"trial": "trial", "review": "review", "publish": "published", "retire": "retired"}[action]
        allowed = {
            SkillStatus.draft.value: {SkillStatus.trial.value},
            SkillStatus.trial.value: {SkillStatus.review.value},
            SkillStatus.review.value: {SkillStatus.published.value},
            SkillStatus.published.value: {SkillStatus.retired.value},
            SkillStatus.retired.value: set(),
        }
        async with self.sessions() as session:
            row = await session.get(SkillDefinition, skill_id, with_for_update=True)
            if not row:
                raise AgentStoreError("Skill 不存在", "skill_not_found", 404)
            if target not in allowed.get(row.status, set()):
                raise AgentStoreError("Skill 生命周期操作顺序无效", "invalid_skill_transition", 409)
            row.status = target
            row.updated_at = now_ms()
            await session.commit()
            return model_dict(row)
