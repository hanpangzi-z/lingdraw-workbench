from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Optional

from .db import AgentStore, AgentStoreError
from .domain import (
    AgentRunStatus,
    AgentStepStatus,
    ApprovalKind,
    OutputType,
    QualityResult,
    RunPlan,
    default_plan,
    now_ms,
    parse_json_object,
)


AsyncDictCallback = Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]]


@dataclass
class AgentDependencies:
    generate_image: Optional[AsyncDictCallback] = None
    call_llm: Optional[AsyncDictCallback] = None
    resolve_llm_fallback: Optional[Callable[[Dict[str, Any]], Optional[Dict[str, str]]]] = None
    publish_canvas: Optional[AsyncDictCallback] = None
    reserve_usage: Optional[Callable[..., Any]] = None
    settle_usage: Optional[Callable[..., Any]] = None
    is_admin_request: Optional[Callable[[Any], bool]] = None


class AgentService:
    def __init__(self, store: AgentStore, dependencies: AgentDependencies, orchestration_mode: str = "local"):
        self.store = store
        self.dependencies = dependencies
        self.orchestration_mode = orchestration_mode
        self._tasks: Dict[str, asyncio.Task] = {}
        self.orchestrator = None

    def set_orchestrator(self, orchestrator):
        self.orchestrator = orchestrator

    def spawn(self, key: str, coroutine):
        current = self._tasks.get(key)
        if current and not current.done():
            return current
        task = asyncio.create_task(coroutine)
        self._tasks[key] = task
        task.add_done_callback(lambda _task: self._tasks.pop(key, None))
        return task

    @staticmethod
    def _valid_plan(plan: RunPlan) -> bool:
        steps = list(plan.steps)
        ids = [step.id for step in steps]
        if len(ids) != len(set(ids)):
            return False
        known = set(ids)
        if not {"Art Director", "Product Fidelity", "Quality Critic"}.issubset({step.role for step in steps}):
            return False
        graph = {step.id: list(step.depends_on) for step in steps}
        if any(dependency not in known or dependency == step_id for step_id, dependencies in graph.items() for dependency in dependencies):
            return False
        visiting, visited = set(), set()

        def visit(step_id: str) -> bool:
            if step_id in visiting:
                return False
            if step_id in visited:
                return True
            visiting.add(step_id)
            if not all(visit(dependency) for dependency in graph[step_id]):
                return False
            visiting.remove(step_id)
            visited.add(step_id)
            return True

        return all(visit(step_id) for step_id in ids)

    async def _wait_until_runnable(self, run_id: str) -> bool:
        current = await self.store.run(run_id)
        while current.status == AgentRunStatus.paused.value:
            await asyncio.sleep(0.5)
            current = await self.store.run(run_id)
        return current.status != AgentRunStatus.cancelled.value

    async def create_run(self, project_id: str, owner_user_id: int, owner_username: str,
                         output_type: str, provider_id: str, model: str, size: str) -> Dict[str, Any]:
        if output_type != OutputType.image.value:
            raise AgentStoreError("Alpha 阶段仅开放图片交付", "output_type_not_enabled", 409)
        bundle = await self.store.project_bundle(project_id, owner_user_id)
        if not bundle.get("brief") or not (bundle["brief"].get("payload") or {}):
            raise AgentStoreError("请先填写并保存 Brief", "brief_required", 409)
        run = await self.store.create_run(project_id, owner_user_id, owner_username, output_type, provider_id, model, size)
        if self.orchestrator:
            await self.orchestrator.start(run["id"])
        else:
            self.spawn(f"plan:{run['id']}", self.plan_run(run["id"]))
        return run

    async def _metered_activity(self, key: str, run: Dict[str, Any], step_id: str, operation: str,
                                category: str, units: int, model: str, callback: AsyncDictCallback,
                                payload: Dict[str, Any]) -> Dict[str, Any]:
        existing = await self.store.activity(key)
        if existing and existing.get("status") == "succeeded":
            return dict(existing.get("output_json") or {})
        if existing and existing.get("status") == "running" and now_ms() - int(existing.get("updated_at") or 0) < 300_000:
            raise AgentStoreError("Activity 正在执行", "activity_in_progress", 409)
        await self.store.start_activity(key, run["id"], step_id, operation)
        event_id = ""
        try:
            if self.dependencies.reserve_usage:
                reserved = self.dependencies.reserve_usage(key, run["owner_username"], category, units, operation, model)
                event_id = reserved[0] if isinstance(reserved, tuple) else str(reserved or "")
            result = await callback(payload)
            output_units = len(result.get("images") or []) if category == "image" else 1
            settled = self.dependencies.settle_usage(event_id, output_units > 0, output_units, "") if event_id and self.dependencies.settle_usage else None
            result = dict(result or {})
            result["_usage_event_id"] = event_id
            result["_charged_points"] = int((settled or {}).get("charged_points") or 0) if isinstance(settled, dict) else 0
            await self.store.finish_activity(key, "succeeded", result, event_id)
            return result
        except Exception as exc:
            if event_id and self.dependencies.settle_usage:
                self.dependencies.settle_usage(event_id, False, 0, str(getattr(exc, "detail", "") or exc))
            await self.store.finish_activity(key, "failed", {}, event_id, str(exc))
            raise

    async def _llm(self, key: str, run: Dict[str, Any], step_id: str, system_prompt: str,
                   message: str, images: Optional[List[str]] = None) -> Dict[str, Any]:
        if not self.dependencies.call_llm:
            raise AgentStoreError("未配置 LLM 能力适配器", "llm_adapter_unavailable", 503)
        return await self._metered_activity(
            key, run, step_id, "agent-llm", "chat", 1, run.get("model") or "",
            self.dependencies.call_llm,
            {
                "provider": run.get("provider_id") or "comfly",
                "model": run.get("model") or "",
                "system_prompt": system_prompt,
                "message": message,
                "images": images or [],
            },
        )

    async def plan_run(self, run_id: str) -> Dict[str, Any]:
        run_row = await self.store.run(run_id)
        run = {column.name: getattr(run_row, column.name) for column in run_row.__table__.columns}
        bundle = await self.store.project_bundle(run["project_id"], run["owner_user_id"])
        brief = dict((bundle.get("brief") or {}).get("payload") or {})
        brand = dict((bundle.get("brand_kit") or {}).get("payload") or {})
        fallback = default_plan(brief, OutputType(run["output_type"]))
        try:
            response = await self._llm(
                f"{run_id}:plan:1:llm", run, "", 
                "你是 Creative Director。只输出 JSON，字段为 objective、output_type、steps；steps 每项包含 id、role、title、instruction、capability、depends_on。仅规划图片任务，必须包含 Art Director、Product Fidelity、Quality Critic。",
                json.dumps({"brief": brief, "brand_kit": brand}, ensure_ascii=False),
            )
            parsed = parse_json_object(response.get("text") or "")
            if parsed:
                parsed["output_type"] = "image"
                try:
                    plan = RunPlan.model_validate(parsed)
                except AttributeError:
                    plan = RunPlan.parse_obj(parsed)
                if not self._valid_plan(plan):
                    raise ValueError("计划缺少必需角色，或依赖图无效")
            else:
                plan = fallback
        except Exception as exc:
            await self.store.append_event(run_id, "plan.fallback", {"reason": str(exc)[:1000]})
            plan = fallback
        payload = plan.model_dump() if hasattr(plan, "model_dump") else plan.dict()
        return await self.store.replace_plan(run_id, payload)

    async def _quality(self, run: Dict[str, Any], step_id: str, brief: Dict[str, Any], brand: Dict[str, Any],
                       assets: List[Dict[str, Any]], attempt: int) -> QualityResult:
        system = (
            "你是 Quality Critic。只输出 JSON：hard_issues(string[])、scores(object，包含 brand/product_fidelity/clarity)、"
            "overall_score(0-100)、summary。严格根据 Brief、品牌资料和图片判断。"
        )
        response = await self._llm(
            f"{run['id']}:{step_id}:{attempt}:quality", run, step_id, system,
            json.dumps({"brief": brief, "brand_kit": brand}, ensure_ascii=False),
            [asset["url"] for asset in assets],
        )
        parsed = parse_json_object(response.get("text") or "") or {
            "hard_issues": ["质量检查未返回结构化结果"], "scores": {}, "overall_score": 0,
            "summary": response.get("text") or "",
        }
        return QualityResult.normalize(parsed)

    async def execute_run(self, run_id: str) -> Dict[str, Any]:
        try:
            return await self._execute_run_impl(run_id)
        except Exception as exc:
            current = await self.store.run(run_id)
            if current.status not in {AgentRunStatus.cancelled.value, AgentRunStatus.succeeded.value}:
                await self.store.transition(run_id, AgentRunStatus.failed.value, error=str(exc))
            raise

    async def _execute_run_impl(self, run_id: str) -> Dict[str, Any]:
        run_row = await self.store.run(run_id)
        run = {column.name: getattr(run_row, column.name) for column in run_row.__table__.columns}
        if run["status"] in {AgentRunStatus.cancelled.value, AgentRunStatus.succeeded.value}:
            return run
        approvals = await self.store.approvals(run_id)
        if run["status"] == AgentRunStatus.awaiting_approval.value and any(
            item["status"] == "pending" and item["kind"] in {ApprovalKind.first_result.value, ApprovalKind.publish.value}
            for item in approvals
        ):
            return {"id": run_id, "status": run["status"], "idempotent_replay": True}
        await self.store.transition(run_id, AgentRunStatus.running.value)
        bundle = await self.store.project_bundle(run["project_id"], run["owner_user_id"])
        brief = dict((bundle.get("brief") or {}).get("payload") or {})
        brand = dict((bundle.get("brand_kit") or {}).get("payload") or {})
        steps = await self.store.steps(run_id)
        creative = next((step for step in steps if step["role"] == "Creative Director"), steps[0] if steps else None)
        art = next((step for step in steps if step["role"] == "Art Director"), None)
        fidelity = next((step for step in steps if step["role"] == "Product Fidelity"), None)
        critic = next((step for step in steps if step["role"] == "Quality Critic"), None)
        if creative:
            await self.store.mark_step(creative["id"], AgentStepStatus.succeeded.value, {"objective": run.get("plan_json", {}).get("objective")})
        if not art or not critic:
            await self.store.transition(run_id, AgentRunStatus.failed.value, error="执行计划缺少 Art Director 或 Quality Critic")
            raise AgentStoreError("执行计划不完整", "invalid_plan", 500)
        if not self.dependencies.generate_image:
            await self.store.transition(run_id, AgentRunStatus.failed.value, error="未配置生图能力适配器")
            raise AgentStoreError("未配置生图能力适配器", "image_adapter_unavailable", 503)

        prompt = str((art.get("input_json") or {}).get("instruction") or brief.get("objective") or brief.get("content") or "")
        parent_assets: List[Dict[str, Any]] = []
        final_assets: List[Dict[str, Any]] = []
        final_quality: Optional[QualityResult] = None
        for attempt in range(1, 4):
            if not await self._wait_until_runnable(run_id):
                return {"id": run_id, "status": AgentRunStatus.cancelled.value}
            await self.store.mark_step(art["id"], AgentStepStatus.running.value, increment_attempt=True)
            image_activity_key = f"{run_id}:{art['id']}:{attempt}:image"
            generated = await self._metered_activity(
                image_activity_key, run, art["id"], "agent-image", "image", 1,
                run.get("model") or "", self.dependencies.generate_image,
                {
                    "prompt": prompt,
                    "provider_id": run.get("provider_id") or "comfly",
                    "model": run.get("model") or "",
                    "size": run.get("size") or "1024x1024",
                    "quality": "auto",
                    "n": 1,
                    "owner_user_id": run.get("owner_user_id") or 0,
                    "owner_username": run.get("owner_username") or "",
                    "reference_images": [{"url": asset["url"], "role": "revision"} for asset in parent_assets[:8]],
                },
            )
            if not await self._wait_until_runnable(run_id):
                await self.store.append_event(run_id, "activity.result_ignored", {
                    "step_id": art["id"], "attempt": attempt, "reason": "run_cancelled",
                }, step_id=art["id"])
                return {"id": run_id, "status": AgentRunStatus.cancelled.value}
            urls = list(generated.get("images") or [])
            if not urls:
                raise AgentStoreError("生图能力没有返回图片", "empty_generation_result", 502)
            final_assets = []
            for index, url in enumerate(urls):
                parent_id = parent_assets[min(index, len(parent_assets) - 1)]["id"] if parent_assets else None
                final_assets.append(await self.store.add_asset(
                    run_id, art["id"], url, f"设计成果 v{attempt}-{index + 1}",
                    generated.get("model") or run.get("model") or "", generated.get("params") or {}, parent_id,
                    f"{image_activity_key}:{index}",
                ))
            await self.store.mark_step(art["id"], AgentStepStatus.succeeded.value,
                                       {"asset_ids": [asset["id"] for asset in final_assets]})
            if fidelity:
                await self.store.mark_step(fidelity["id"], AgentStepStatus.succeeded.value,
                                           {"checked_asset_ids": [asset["id"] for asset in final_assets]})
            if not await self._wait_until_runnable(run_id):
                return {"id": run_id, "status": AgentRunStatus.cancelled.value}
            await self.store.mark_step(critic["id"], AgentStepStatus.running.value, increment_attempt=True)
            final_quality = await self._quality(run, critic["id"], brief, brand, final_assets, attempt)
            quality_payload = final_quality.model_dump() if hasattr(final_quality, "model_dump") else final_quality.dict()
            await self.store.add_quality_report(
                run_id, critic["id"], [asset["id"] for asset in final_assets], quality_payload,
                f"{run_id}:{critic['id']}:{attempt}:quality",
            )
            await self.store.mark_step(critic["id"], AgentStepStatus.succeeded.value, quality_payload)
            if final_quality.passed:
                break
            if attempt < 3:
                parent_assets = final_assets
                issues = "；".join(final_quality.hard_issues or [final_quality.summary or "提升整体质量"])
                prompt = f"{prompt}\n请修正以下问题：{issues}"
        if final_quality and not final_quality.passed:
            await self.store.append_event(run_id, "quality.manual_required", {"attempts": 3})
        if not await self._wait_until_runnable(run_id):
            return {"id": run_id, "status": AgentRunStatus.cancelled.value}
        approval = await self.store.create_approval(run_id, ApprovalKind.first_result.value)
        return {"run_id": run_id, "assets": final_assets, "quality": final_quality, "approval": approval}

    async def action(self, run_id: str, owner_user_id: int, username: str, action: str,
                     approval_id: str = "", reason: str = "") -> Dict[str, Any]:
        run_row = await self.store.run_owned(run_id, owner_user_id)
        if action == "cancel":
            result = await self.store.transition(run_id, AgentRunStatus.cancelled.value)
            await self.store.cancel_unfinished_steps(run_id)
            if self.orchestrator:
                await self.orchestrator.signal(run_id, "cancel")
            return result
        if action == "pause":
            if run_row.status != AgentRunStatus.running.value:
                raise AgentStoreError("只有运行中的任务可以暂停", "invalid_run_action", 409)
            result = await self.store.transition(run_id, AgentRunStatus.paused.value)
            if self.orchestrator:
                await self.orchestrator.signal(run_id, "pause")
            return result
        if action == "resume":
            if run_row.status != AgentRunStatus.paused.value:
                raise AgentStoreError("只有已暂停任务可以继续", "invalid_run_action", 409)
            result = await self.store.transition(run_id, AgentRunStatus.running.value)
            if self.orchestrator:
                await self.orchestrator.signal(run_id, "resume")
            return result
        if action not in {"approve", "reject"}:
            raise AgentStoreError("不支持的操作", "invalid_run_action", 400)
        if not approval_id:
            raise AgentStoreError("审批操作必须提供 approval_id", "approval_id_required", 422)
        if action == "reject" and not reason.strip():
            raise AgentStoreError("驳回必须填写原因", "approval_reason_required", 422)
        approval = await self.store.pending_approval(run_id, approval_id)
        decision = await self.store.decide_approval(run_id, approval.id, action == "approve", username, reason)
        if action == "reject":
            next_status = AgentRunStatus.draft.value if approval.kind == ApprovalKind.plan.value else AgentRunStatus.paused.value
            result = await self.store.transition(run_id, next_status, error=reason)
            if self.orchestrator and approval.kind == ApprovalKind.plan.value:
                await self.orchestrator.signal(run_id, "cancel")
            return result
        if approval.kind == ApprovalKind.plan.value:
            result = await self.store.transition(run_id, AgentRunStatus.running.value)
            if self.orchestrator:
                await self.orchestrator.signal(run_id, "approve_plan")
            else:
                self.spawn(f"execute:{run_id}", self.execute_run(run_id))
            return {"run": result, "approval": decision}
        if approval.kind == ApprovalKind.first_result.value:
            next_approval = await self.store.create_approval(run_id, ApprovalKind.publish.value)
            if self.orchestrator:
                await self.orchestrator.signal(run_id, "approve_first_result")
            return {"approval": decision, "next_approval": next_approval}
        result = await self.store.transition(run_id, AgentRunStatus.awaiting_approval.value, approval_kind="")
        if self.orchestrator:
            await self.orchestrator.signal(run_id, "approve_publish")
        return {"run": result, "approval": decision, "publish_ready": True}

    async def revise(self, run_id: str, owner_user_id: int, asset_id: str, instruction: str) -> Dict[str, Any]:
        run_row = await self.store.run_owned(run_id, owner_user_id)
        run = {column.name: getattr(run_row, column.name) for column in run_row.__table__.columns}
        parents = await self.store.assets(run_id, [asset_id])
        if not parents:
            raise AgentStoreError("成果不存在", "asset_not_found", 404)
        art_step = next((step for step in await self.store.steps(run_id) if step["role"] == "Art Director"), None)
        if not art_step or not self.dependencies.generate_image:
            raise AgentStoreError("当前运行无法创建修改版本", "revision_unavailable", 409)
        attempt = int(art_step.get("attempt_count") or 0) + 1
        revision_activity_key = f"{run_id}:{art_step['id']}:{attempt}:revision"
        result = await self._metered_activity(
            revision_activity_key, run, art_step["id"], "agent-revision", "image", 1,
            run.get("model") or "", self.dependencies.generate_image,
            {
                "prompt": instruction,
                "provider_id": run.get("provider_id") or "comfly",
                "model": run.get("model") or "",
                "size": run.get("size") or "1024x1024",
                "quality": "auto", "n": 1,
                "owner_user_id": run.get("owner_user_id") or 0,
                "owner_username": run.get("owner_username") or "",
                "reference_images": [{"url": parents[0]["url"], "role": "revision"}],
            },
        )
        url = next(iter(result.get("images") or []), "")
        if not url:
            raise AgentStoreError("修改没有返回新图片", "empty_revision_result", 502)
        asset = await self.store.add_asset(run_id, art_step["id"], url, f"{parents[0]['name']} 修改版",
                                           result.get("model") or run.get("model") or "", result.get("params") or {}, asset_id,
                                           f"{revision_activity_key}:0")
        if not any(item["status"] == "pending" for item in await self.store.approvals(run_id)):
            await self.store.create_approval(run_id, ApprovalKind.first_result.value)
        return asset

    async def publish(self, run_id: str, owner_user_id: int, asset_ids: List[str], canvas_id: str) -> Dict[str, Any]:
        run_row = await self.store.run_owned(run_id, owner_user_id)
        approvals = await self.store.approvals(run_id)
        if not any(item["kind"] == ApprovalKind.publish.value and item["status"] == "approved" for item in approvals):
            raise AgentStoreError("最终发布尚未批准", "publish_approval_required", 409)
        assets = await self.store.assets(run_id, asset_ids)
        if len({item["id"] for item in assets}) != len(set(asset_ids)):
            raise AgentStoreError("包含不属于当前运行的成果", "asset_not_found", 404)
        if not self.dependencies.publish_canvas:
            raise AgentStoreError("未配置画布发布适配器", "canvas_adapter_unavailable", 503)
        bundle = await self.store.project_bundle(run_row.project_id, owner_user_id)
        result = await self.dependencies.publish_canvas({
            "run": {column.name: getattr(run_row, column.name) for column in run_row.__table__.columns},
            "assets": assets,
            "brief": dict((bundle.get("brief") or {}).get("payload") or {}),
            "canvas_id": canvas_id,
        })
        await self.store.mark_assets_published(run_id, result.get("asset_library_items") or {})
        await self.store.transition(run_id, AgentRunStatus.succeeded.value)
        await self.store.append_event(run_id, "run.published", result)
        return result
