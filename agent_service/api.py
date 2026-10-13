from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import secrets
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from .db import AgentStore, AgentStoreError, BrandKit, ProjectBrief
from .domain import (
    ProjectCreate,
    PublishRequest,
    RevisionCreate,
    RunAction,
    RunCreate,
    SkillAction,
    SkillCreate,
    VersionedDocumentUpdate,
)
from .orchestration import build_orchestrator
from .service import AgentDependencies, AgentService
from .workbench_analysis import (
    MARKER_RECOGNITION_SYSTEM_PROMPT,
    MODULE_REVISION_SYSTEM_PROMPT,
    PLAN_SYSTEM_PROMPT,
    REVIEW_SYSTEM_PROMPT,
    WorkbenchMarkerRecognition,
    WorkbenchMarkerRecognitionRequest,
    WorkbenchPlanRequest,
    WorkbenchRoutingDecision,
    WorkbenchWorkflowModuleRevision,
    WorkbenchWorkflowModuleRevisionRequest,
    WorkbenchResultReview,
    WorkbenchReviewRequest,
    parse_analysis,
    marker_recognition_user_message,
    module_revision_user_message,
    plan_user_message,
    review_user_message,
    validate_result_review,
    validate_module_revision,
    validate_routing_decision,
)


router = APIRouter(prefix="/api/agent", tags=["design-agent"])
_dependencies = AgentDependencies()
_service: Optional[AgentService] = None
_service_lock = asyncio.Lock()
_workbench_executor_id = f"api-{os.getpid()}-{secrets.token_hex(8)}"
_billing_recovery_tasks = set()
_workbench_logger = logging.getLogger("lingdraw.workbench")
_WORKBENCH_FALLBACK_OPERATIONS = frozenset({
    "workbench-plan", "workbench-plan-followup", "workbench-review", "workbench-module-revise",
})


def correlated_upstream_diagnostic(exc, operation: str, request_id: str,
                                   owner_user_id: int, provider: str, model: str):
    raw = getattr(exc, "upstream_diagnostic", None)
    if not isinstance(raw, dict):
        return None
    allowed = (
        "diagnostic_id",
        "timestamp",
        "provider",
        "model",
        "upstream_status",
        "upstream_code",
        "upstream_type",
        "upstream_message",
        "retry_after",
        "upstream_request_id",
    )
    diagnostic = {key: raw.get(key) for key in allowed if raw.get(key) not in {None, ""}}
    diagnostic.update({
        "operation": operation,
        "request_id": request_id,
        "owner_user_id": int(owner_user_id),
    })
    diagnostic.setdefault("provider", provider or "")
    diagnostic.setdefault("model", model or "")
    _workbench_logger.warning(
        "[WORKBENCH-DIAG] %s",
        json.dumps(diagnostic, ensure_ascii=False, separators=(",", ":")),
    )
    return diagnostic


def configure_agent_dependencies(**kwargs):
    for key, value in kwargs.items():
        if not hasattr(_dependencies, key):
            raise ValueError(f"Unknown agent dependency: {key}")
        setattr(_dependencies, key, value)


def agent_enabled() -> bool:
    return os.getenv("DESIGN_AGENT_ENABLED", "1").strip().lower() not in {"0", "false", "off", "no"}


def workbench_llm_timeout_seconds() -> float:
    """Bound one workbench analysis/review model selection, including retries."""
    raw = os.getenv("WORKBENCH_LLM_TIMEOUT_SECONDS", "90").strip()
    try:
        value = float(raw)
    except (TypeError, ValueError):
        value = 90.0
    return max(0.05, min(value, 300.0))


def database_url() -> str:
    from mysql_runtime import required_url
    return required_url("AGENT_DATABASE_URL").set(drivername="mysql+asyncmy").render_as_string(hide_password=False)


async def get_service() -> AgentService:
    global _service
    if not agent_enabled():
        raise AgentStoreError("设计智能体功能尚未启用", "agent_disabled", 503)
    if _service is not None:
        return _service
    async with _service_lock:
        if _service is None:
            url = database_url()
            auto_create = os.getenv("AGENT_AUTO_CREATE_SCHEMA", "0") == "1"
            store = AgentStore(url, auto_create=auto_create)
            await store.initialize()
            mode = os.getenv("AGENT_ORCHESTRATOR", "local").strip().lower()
            service = AgentService(store, _dependencies, orchestration_mode=mode)
            service.set_orchestrator(build_orchestrator(service, mode))
            _service = service
            await recover_pending_workbench_billing(store)
    return _service


async def shutdown_agent_service() -> None:
    global _service
    service, _service = _service, None
    for task in tuple(_billing_recovery_tasks):
        task.cancel()
    if _billing_recovery_tasks:
        await asyncio.gather(*tuple(_billing_recovery_tasks), return_exceptions=True)
    _billing_recovery_tasks.clear()
    if service is not None:
        await service.store.close()


def actor(request: Request):
    user_id = int(getattr(request.state, "platform_user_id", 0) or 0)
    username = str(getattr(request.state, "platform_user", "") or "")
    if not user_id or not username:
        raise HTTPException(status_code=401, detail="请先登录")
    allowlist = {
        item.strip().casefold()
        for item in os.getenv("AGENT_ALLOWED_USERS", "").split(",")
        if item.strip()
    }
    if allowlist and "*" not in allowlist and username.casefold() not in allowlist:
        raise HTTPException(status_code=403, detail="设计智能体尚未向当前账号开放")
    return user_id, username


def store_http_error(exc: Exception):
    if isinstance(exc, AgentStoreError):
        raise HTTPException(status_code=exc.status_code, detail={"message": exc.message, "code": exc.code}) from exc
    raise exc


def transient_workbench_error(exc: Exception) -> bool:
    status_code = int(getattr(exc, "status_code", 0) or 0)
    detail = getattr(exc, "detail", "")
    error_code = ""
    if isinstance(detail, dict):
        error_code = str(detail.get("code") or "")
        detail = detail.get("message") or detail.get("detail") or detail
    if status_code in {502, 503, 504} and error_code == "upstream_transport_error":
        return True
    message = str(detail or exc).casefold()
    return status_code in {502, 503, 504} and any(marker in message for marker in (
        "server disconnected", "remoteprotocolerror", "connection reset", "timeout", "timed out",
        "连接中断", "连接重置", "请求超时", "请求上游接口失败", "upstream request failed",
    ))


def workbench_fallback_route(operation: str, provider: str, model: str, exc: Exception):
    if operation not in _WORKBENCH_FALLBACK_OPERATIONS or not _dependencies.resolve_llm_fallback:
        return None
    try:
        route = _dependencies.resolve_llm_fallback({
            "operation": operation,
            "provider": provider,
            "model": model,
            "error_type": type(exc).__name__,
        })
    except Exception:
        _workbench_logger.exception(
            "[WORKBENCH-FALLBACK-RESOLVE] operation=%s provider=%s model=%s",
            operation, provider, model,
        )
        return None
    if not isinstance(route, dict):
        return None
    fallback_provider = str(route.get("provider") or "").strip()
    fallback_model = str(route.get("model") or "").strip()
    if not fallback_provider or not fallback_model:
        return None
    if fallback_provider.casefold() == str(provider or "").strip().casefold() and fallback_model.casefold() == str(model or "").strip().casefold():
        return None
    return {"provider": fallback_provider, "model": fallback_model}


def workbench_request_fingerprint(provider: str, model: str, message: str, images,
                                  allow_model_fallback: bool = True) -> str:
    canonical = json.dumps({
        "provider": str(provider or ""),
        "model": str(model or ""),
        "message": message,
        "images": [str(item) for item in (images or []) if str(item).strip()],
        "allow_model_fallback": bool(allow_model_fallback),
    }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def workbench_heartbeat_loop(store: AgentStore, user_id: int, operation: str,
                                   request_id: str, fingerprint: str, claim_token: str):
    try:
        while True:
            await asyncio.sleep(30)
            if not await store.heartbeat_workbench_request(
                user_id, operation, request_id, fingerprint, claim_token,
            ):
                return
    except asyncio.CancelledError:
        return


async def stop_workbench_heartbeat(task):
    if task is None:
        return
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)


async def settle_persisted_workbench_billing(store: AgentStore, record) -> bool:
    result = dict(record.get("result_json") or {})
    event_id = str(result.get("_usage_event_id") or "")
    claim_token = str(result.get("_claim_token") or "")
    if not event_id or not _dependencies.settle_usage:
        return False
    settled = _dependencies.settle_usage(event_id, True, 1, "")
    charged_points = int(result.get("charged_points") or 0)
    if isinstance(settled, dict) and (
        settled.get("_settled_now") or result.get("_usage_was_reserved")
    ):
        charged_points = int(settled.get("charged_points") or 0)
    await store.update_workbench_result(
        int(record["owner_user_id"]),
        str(record["operation"]),
        str(record["request_id"]),
        str(record["fingerprint"]),
        {"charged_points": charged_points, "billing_pending": False},
        claim_token=claim_token,
    )
    return True


async def retry_workbench_billing(store: AgentStore, record):
    delay = 1
    while True:
        await asyncio.sleep(delay)
        try:
            if await settle_persisted_workbench_billing(store, record):
                return
        except asyncio.CancelledError:
            raise
        except Exception:
            delay = min(delay * 2, 300)


def schedule_workbench_billing_recovery(store: AgentStore, record):
    task = asyncio.create_task(retry_workbench_billing(store, record))
    _billing_recovery_tasks.add(task)
    task.add_done_callback(_billing_recovery_tasks.discard)


async def recover_pending_workbench_billing(store: AgentStore):
    if not _dependencies.settle_usage:
        return
    for record in await store.pending_workbench_billing():
        try:
            await settle_persisted_workbench_billing(store, record)
        except Exception:
            schedule_workbench_billing_recovery(store, record)


async def run_workbench_analysis(user_id: int, username: str, request_id: str, operation: str,
                                 provider: str, model: str, system_prompt: str, message: str,
                                 images, response_model, validator=None, usage_operation: str = "",
                                 allow_model_fallback: bool = True):
    image_urls = [str(item) for item in (images or []) if str(item).strip()]
    fingerprint = workbench_request_fingerprint(
        provider, model, message, image_urls, allow_model_fallback,
    )
    effective_provider = provider or "comfly"
    effective_model = model or ""
    try:
        store = (await get_service()).store
        claimed = await store.claim_workbench_request(
            user_id, operation, request_id, fingerprint, provider, model,
            executor_id=_workbench_executor_id,
        )
    except AgentStoreError as exc:
        store_http_error(exc)
    request_record = claimed["request"]
    if claimed["action"] == "replay":
        replay = dict(request_record.get("result_json") or {})
        replay_event_id = str(replay.get("_usage_event_id") or "")
        replay_claim_token = str(replay.get("_claim_token") or "")
        if replay_event_id and _dependencies.settle_usage:
            try:
                settled = _dependencies.settle_usage(replay_event_id, True, 1, "")
                if isinstance(settled, dict) and settled.get("_settled_now"):
                    replay["charged_points"] = int(settled.get("charged_points") or 0)
                replay.pop("billing_pending", None)
                await store.update_workbench_result(
                    user_id, operation, request_id, fingerprint,
                    {"charged_points": replay["charged_points"], "billing_pending": False},
                    claim_token=replay_claim_token,
                )
            except Exception:
                replay["billing_pending"] = True
                try:
                    record = await store.update_workbench_result(
                        user_id, operation, request_id, fingerprint,
                        {"charged_points": int(replay.get("charged_points") or 0), "billing_pending": True},
                        claim_token=replay_claim_token,
                    )
                    schedule_workbench_billing_recovery(store, record)
                except Exception:
                    pass
        return {key: value for key, value in replay.items() if not key.startswith("_")}
    claim_token = str((request_record.get("result_json") or {}).get("_claim_token") or "")
    heartbeat_task = asyncio.create_task(workbench_heartbeat_loop(
        store, user_id, operation, request_id, fingerprint, claim_token,
    ))
    owner_task = asyncio.current_task()
    if owner_task is not None:
        owner_task.add_done_callback(lambda _done, task=heartbeat_task: task.cancel())

    billing_operation = usage_operation or operation
    event_id = ""
    usage_created = False
    usage_status_at_reserve = ""
    try:
        if not _dependencies.call_llm:
            raise HTTPException(status_code=503, detail="未配置设计分析模型")
        if _dependencies.reserve_usage:
            reserved = _dependencies.reserve_usage(
                f"workbench:{user_id}:{request_id}:{billing_operation}",
                username,
                "chat",
                1,
                billing_operation,
                model,
            )
            if isinstance(reserved, tuple):
                event_id = str(reserved[0] or "")
                usage_created = bool(reserved[1])
                usage_status_at_reserve = str(getattr(reserved, "prior_status", "") or "")
            else:
                event_id = str(reserved or "")
                usage_created = bool(event_id)

        async def call_selected_model(selected_provider: str, selected_model: str, selected_system_prompt: str = "",
                                      selected_message: str = ""):
            call_system_prompt = selected_system_prompt or system_prompt
            call_message = selected_message or message

            async def invoke_with_retries():
                for attempt in range(3):
                    try:
                        return await _dependencies.call_llm({
                            "provider": selected_provider,
                            "model": selected_model,
                            "system_prompt": call_system_prompt,
                            "message": call_message,
                            "images": image_urls,
                        })
                    except Exception as call_error:
                        if attempt >= 2 or not transient_workbench_error(call_error):
                            raise
                        await asyncio.sleep(0.5 * (2 ** attempt))

            timeout_seconds = workbench_llm_timeout_seconds()
            try:
                return await asyncio.wait_for(invoke_with_retries(), timeout=timeout_seconds)
            except asyncio.TimeoutError as timeout_error:
                raise HTTPException(
                    status_code=504,
                    detail={
                        "code": "upstream_transport_error",
                        "message": "设计分析上游响应超时，请重试。",
                    },
                ) from timeout_error

        try:
            result = await call_selected_model(effective_provider, effective_model)
        except Exception as primary_error:
            fallback_route = workbench_fallback_route(
                operation, effective_provider, effective_model, primary_error,
            ) if allow_model_fallback else None
            if not fallback_route:
                raise
            detail = getattr(primary_error, "detail", {})
            upstream = getattr(primary_error, "upstream_diagnostic", {})
            _workbench_logger.warning(
                "[WORKBENCH-FALLBACK] %s",
                json.dumps({
                    "operation": operation,
                    "request_id": request_id,
                    "fallback_from_provider": effective_provider,
                    "fallback_from": effective_model,
                    "fallback_to_provider": fallback_route["provider"],
                    "fallback_to": fallback_route["model"],
                    "upstream_status": (
                        upstream.get("upstream_status")
                        if isinstance(upstream, dict) else None
                    ),
                    "upstream_code": (
                        detail.get("code")
                        if isinstance(detail, dict) else ""
                    ),
                    "diagnostic_id": (
                        upstream.get("diagnostic_id")
                        if isinstance(upstream, dict) else None
                    ),
                }, ensure_ascii=False, separators=(",", ":")),
            )
            fallback_info = {
                "used": True,
                "from_provider": effective_provider,
                "from_model": effective_model,
                "to_provider": fallback_route["provider"],
                "to_model": fallback_route["model"],
            }
            effective_provider = fallback_route["provider"]
            effective_model = fallback_route["model"]
            result = await call_selected_model(effective_provider, effective_model)
        else:
            fallback_info = None
        def parse_and_validate(raw_result):
            parsed = parse_analysis(str((raw_result or {}).get("text") or ""), response_model)
            return validator(parsed) if validator else parsed

        original_request = json.loads(message) if message.lstrip().startswith("{") else message
        def validation_correction(raw_result, validation_error, attempt: int, fallback: bool = False):
            correction_instruction = (
                "重新查看全部输入图片，只返回一份完整且通过校验的 JSON。不得省略逐图清单。"
                if operation in {"workbench-plan", "workbench-plan-followup", "workbench-review"}
                else "重新查看输入并只返回一份符合指定结构的完整 JSON。"
            )
            correction_message = json.dumps({
                "original_request": original_request,
                "previous_invalid_output": str((raw_result or {}).get("text") or "")[:12000],
                "validation_error": str(validation_error),
                "correction_attempt": attempt,
                "fallback_after_validation": fallback,
                "instruction": correction_instruction,
            }, ensure_ascii=False)
            correction_system_prompt = (
                f"{system_prompt}\n\n"
                "结构纠错：上一次回答未通过服务端完整性校验。必须按校验错误重新查看全部输入图，"
                "补齐逐图记录并保持其他 JSON 字段完整；不要解释，不要沿用未经核实的总括判断。"
            )
            return correction_system_prompt, correction_message

        async def parse_with_repairs(initial_result, selected_provider: str, selected_model: str):
            current_result = initial_result
            last_error = None
            for validation_attempt in range(3):
                try:
                    return parse_and_validate(current_result), current_result, None
                except ValueError as validation_error:
                    last_error = validation_error
                    if validation_attempt >= 2:
                        break
                    correction_system_prompt, correction_message = validation_correction(
                        current_result, validation_error, validation_attempt + 1,
                    )
                    current_result = await call_selected_model(
                        selected_provider, selected_model, correction_system_prompt, correction_message,
                    )
            return None, current_result, last_error

        analysis, result, validation_error = await parse_with_repairs(
            result, effective_provider, effective_model,
        )
        if validation_error is not None:
            fallback_route = workbench_fallback_route(
                operation, effective_provider, effective_model, validation_error,
            ) if allow_model_fallback else None
            if not fallback_route:
                raise validation_error
            _workbench_logger.warning(
                "[WORKBENCH-FALLBACK] %s",
                json.dumps({
                    "operation": operation,
                    "request_id": request_id,
                    "fallback_from_provider": effective_provider,
                    "fallback_from": effective_model,
                    "fallback_to_provider": fallback_route["provider"],
                    "fallback_to": fallback_route["model"],
                    "validation_error": str(validation_error),
                }, ensure_ascii=False, separators=(",", ":")),
            )
            fallback_info = {
                "used": True,
                "from_provider": effective_provider,
                "from_model": effective_model,
                "to_provider": fallback_route["provider"],
                "to_model": fallback_route["model"],
                "reason": "validation_failed",
            }
            effective_provider = fallback_route["provider"]
            effective_model = fallback_route["model"]
            correction_system_prompt, correction_message = validation_correction(
                result, validation_error, 3, fallback=True,
            )
            result = await call_selected_model(
                effective_provider, effective_model, correction_system_prompt, correction_message,
            )
            analysis, result, validation_error = await parse_with_repairs(
                result, effective_provider, effective_model,
            )
            if validation_error is not None:
                raise validation_error
        response = {
            "analysis": analysis.model_dump() if hasattr(analysis, "model_dump") else analysis.dict(),
            "model": str((result or {}).get("model") or effective_model),
            "charged_points": 0,
            "usage_reused": bool(event_id and not usage_created),
            "_usage_event_id": event_id,
            "_claim_token": claim_token,
            "_usage_was_reserved": bool(usage_created or usage_status_at_reserve == "reserved"),
        }
        if fallback_info:
            response["fallback"] = fallback_info
        if event_id and _dependencies.settle_usage:
            # Persist this before settlement so a process crash can be repaired
            # by the startup scan without another client request.
            response["billing_pending"] = True
        await stop_workbench_heartbeat(heartbeat_task)
        heartbeat_task = None
        await store.finish_workbench_request(
            user_id, operation, request_id, fingerprint, "succeeded", response,
            claim_token=claim_token,
        )
        if event_id and _dependencies.settle_usage:
            try:
                settled = _dependencies.settle_usage(event_id, True, 1, "")
                if isinstance(settled, dict) and settled.get("_settled_now"):
                    response["charged_points"] = int(settled.get("charged_points") or 0)
                response.pop("billing_pending", None)
                await store.update_workbench_result(
                    user_id, operation, request_id, fingerprint,
                    {"charged_points": response["charged_points"], "billing_pending": False},
                    claim_token=claim_token,
                )
            except Exception:
                response["billing_pending"] = True
                try:
                    record = await store.update_workbench_result(
                        user_id, operation, request_id, fingerprint,
                        {"charged_points": response["charged_points"], "billing_pending": True},
                        claim_token=claim_token,
                    )
                    schedule_workbench_billing_recovery(store, record)
                except Exception:
                    pass
        return {key: value for key, value in response.items() if not key.startswith("_")}
    except Exception as exc:
        await stop_workbench_heartbeat(heartbeat_task)
        heartbeat_task = None
        detail = getattr(exc, "detail", "")
        error = json.dumps(detail, ensure_ascii=False) if isinstance(detail, dict) else str(detail or exc)
        diagnostic = correlated_upstream_diagnostic(
            exc, operation, request_id, user_id, effective_provider, effective_model,
        )
        failure_result = {"diagnostic": diagnostic} if diagnostic else None
        try:
            await store.finish_workbench_request(
                user_id, operation, request_id, fingerprint, "failed",
                result=failure_result, error=error,
                claim_token=claim_token,
            )
        except AgentStoreError as finish_error:
            if finish_error.code == "workbench_request_lease_lost":
                store_http_error(finish_error)
        if event_id and _dependencies.settle_usage:
            _dependencies.settle_usage(event_id, False, 0, error)
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(
            status_code=502,
            detail={"code": "agent_analysis_failed", "message": f"设计分析模型返回不可用：{exc}"},
        ) from exc


@router.get("/health")
async def agent_health():
    try:
        service = await get_service()
        await asyncio.wait_for(service.store.health(),timeout=5)
        if service.orchestration_mode=='temporal':
            from temporalio.api.workflowservice.v1 import DescribeNamespaceRequest
            client=await asyncio.wait_for(service.orchestrator.client(),timeout=5)
            await asyncio.wait_for(client.workflow_service.describe_namespace(DescribeNamespaceRequest(namespace=client.namespace)),timeout=5)
        return {
            "enabled": True,
            "database": "mysql",
            "orchestrator": service.orchestration_mode,
            "task_queue": os.getenv("TEMPORAL_TASK_QUEUE", "lingdraw-design-agent"),
        }
    except Exception as exc:
        if isinstance(exc, AgentStoreError):
            return JSONResponse(status_code=exc.status_code, content={"enabled": False, "code": exc.code, "detail": exc.message})
        return JSONResponse(status_code=503, content={"enabled": False, "code": "agent_unavailable", "detail": str(exc)})


@router.post("/workbench/plan")
async def create_workbench_plan(payload: WorkbenchPlanRequest, request: Request):
    user_id, username = actor(request)
    clarification_followup = bool(
        payload.clarification_id
        or payload.clarification_answers
        or payload.skip_clarification
    )
    operation = "workbench-plan-followup" if clarification_followup else "workbench-plan"
    if clarification_followup:
        store = (await get_service()).store
        original = await store.get_workbench_request(
            user_id, "workbench-plan", payload.request_id
        )
        original_analysis = (
            ((original or {}).get("result_json") or {}).get("analysis") or {}
        )
        original_clarification = original_analysis.get("clarification") or {}
        if (
            not original
            or original.get("status") != "succeeded"
            or original_analysis.get("status") != "needs_clarification"
            or not payload.clarification_id
            or str(original_clarification.get("id") or "") != payload.clarification_id
        ):
            raise HTTPException(status_code=409, detail={
                "code": "workbench_followup_invalid",
                "message": "澄清续答与原需求分析不匹配，请重新发起一次明确的需求分析。",
                "request_id": payload.request_id,
            })
    image_urls = [item.url for item in payload.reference_images]
    for asset in payload.selected_assets:
        if not isinstance(asset, dict):
            continue
        url = str(asset.get("url") or asset.get("image_url") or asset.get("src") or "").strip()
        if url and url not in image_urls:
            image_urls.append(url)
    return await run_workbench_analysis(
        user_id,
        username,
        payload.request_id,
        operation,
        payload.provider,
        payload.model,
        PLAN_SYSTEM_PROMPT,
        plan_user_message(payload),
        image_urls,
        WorkbenchRoutingDecision,
        lambda decision: validate_routing_decision(decision, payload),
        usage_operation="workbench-plan",
        allow_model_fallback=payload.allow_model_fallback,
    )


@router.post("/workbench/review")
async def create_workbench_review(payload: WorkbenchReviewRequest, request: Request):
    user_id, username = actor(request)
    return await run_workbench_analysis(
        user_id,
        username,
        payload.request_id,
        "workbench-review",
        payload.provider,
        payload.model,
        REVIEW_SYSTEM_PROMPT,
        review_user_message(payload),
        [
            payload.image_url,
            *[item.url for item in payload.reference_images],
            *[item.url for item in payload.workflow_reference_images],
        ],
        WorkbenchResultReview,
        lambda review: validate_result_review(review, payload),
        allow_model_fallback=payload.allow_model_fallback,
    )


@router.post("/workbench/module-revise")
async def revise_workbench_module(payload: WorkbenchWorkflowModuleRevisionRequest, request: Request):
    user_id, username = actor(request)
    return await run_workbench_analysis(
        user_id,
        username,
        payload.request_id,
        "workbench-module-revise",
        payload.provider,
        payload.model,
        MODULE_REVISION_SYSTEM_PROMPT,
        module_revision_user_message(payload),
        [],
        WorkbenchWorkflowModuleRevision,
        lambda revision: validate_module_revision(revision, payload),
        allow_model_fallback=payload.allow_model_fallback,
    )


@router.post("/workbench/marker-label")
async def recognize_workbench_marker(payload: WorkbenchMarkerRecognitionRequest, request: Request):
    user_id, username = actor(request)
    return await run_workbench_analysis(
        user_id,
        username,
        payload.request_id,
        "workbench-marker-label",
        payload.provider,
        payload.model,
        MARKER_RECOGNITION_SYSTEM_PROMPT,
        marker_recognition_user_message(payload),
        [payload.image_url],
        WorkbenchMarkerRecognition,
        allow_model_fallback=payload.allow_model_fallback,
    )


@router.get("/projects")
async def list_agent_projects(request: Request):
    user_id, _ = actor(request)
    try:
        return {"projects": await (await get_service()).store.list_projects(user_id)}
    except Exception as exc:
        store_http_error(exc)


@router.post("/projects", status_code=201)
async def create_agent_project(payload: ProjectCreate, request: Request):
    user_id, username = actor(request)
    try:
        project = await (await get_service()).store.create_project(user_id, username, payload.name)
        return {"project": project}
    except Exception as exc:
        store_http_error(exc)


@router.get("/projects/{project_id}")
async def get_agent_project(project_id: str, request: Request):
    user_id, _ = actor(request)
    try:
        return await (await get_service()).store.project_bundle(project_id, user_id)
    except Exception as exc:
        store_http_error(exc)


@router.put("/projects/{project_id}/brief")
async def save_agent_brief(project_id: str, payload: VersionedDocumentUpdate, request: Request):
    user_id, _ = actor(request)
    try:
        brief = await (await get_service()).store.save_document(ProjectBrief, project_id, user_id, payload.version, payload.payload)
        return {"brief": brief}
    except Exception as exc:
        store_http_error(exc)


@router.put("/projects/{project_id}/brand-kit")
async def save_agent_brand_kit(project_id: str, payload: VersionedDocumentUpdate, request: Request):
    user_id, _ = actor(request)
    try:
        brand = await (await get_service()).store.save_document(BrandKit, project_id, user_id, payload.version, payload.payload)
        return {"brand_kit": brand}
    except Exception as exc:
        store_http_error(exc)


@router.post("/runs")
async def create_agent_run(payload: RunCreate, request: Request):
    user_id, username = actor(request)
    try:
        run = await (await get_service()).create_run(
            payload.project_id, user_id, username, payload.output_type.value,
            payload.provider_id, payload.model, payload.size,
        )
        return JSONResponse(status_code=202, content={"run": run})
    except Exception as exc:
        store_http_error(exc)


@router.get("/runs/{run_id}")
async def get_agent_run(run_id: str, request: Request):
    user_id, _ = actor(request)
    try:
        return await (await get_service()).store.snapshot(run_id, user_id)
    except Exception as exc:
        store_http_error(exc)


@router.get("/runs/{run_id}/events")
async def stream_agent_run_events(run_id: str, request: Request,
                                  last_event_id: str = Header(default="0", alias="Last-Event-ID")):
    user_id, _ = actor(request)
    service = await get_service()
    try:
        await service.store.run_owned(run_id, user_id)
    except Exception as exc:
        store_http_error(exc)
    try:
        cursor = max(0, int(last_event_id or 0))
    except ValueError:
        cursor = 0

    async def event_stream():
        nonlocal cursor
        idle_ticks = 0
        while True:
            if await request.is_disconnected():
                break
            events = await service.store.events_after(run_id, cursor)
            if events:
                idle_ticks = 0
                for event in events:
                    cursor = int(event["id"])
                    data = {
                        "id": cursor,
                        "type": event["event_type"],
                        "timestamp": event["created_at"],
                        "run_id": run_id,
                        "step_id": event.get("step_id") or "",
                        "payload": event.get("payload_json") or {},
                    }
                    yield f"id: {cursor}\nevent: {event['event_type']}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
            else:
                idle_ticks += 1
                if idle_ticks >= 20:
                    idle_ticks = 0
                    yield ": heartbeat\n\n"
            await asyncio.sleep(0.75)

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/runs/{run_id}/actions")
async def agent_run_action(run_id: str, payload: RunAction, request: Request):
    user_id, username = actor(request)
    try:
        return await (await get_service()).action(
            run_id, user_id, username, payload.action, payload.approval_id, payload.reason
        )
    except Exception as exc:
        store_http_error(exc)


@router.post("/runs/{run_id}/revisions", status_code=201)
async def create_agent_revision(run_id: str, payload: RevisionCreate, request: Request):
    user_id, _ = actor(request)
    try:
        return {"asset": await (await get_service()).revise(run_id, user_id, payload.asset_id, payload.instruction)}
    except Exception as exc:
        store_http_error(exc)


@router.post("/runs/{run_id}/publish-to-canvas")
async def publish_agent_run(run_id: str, payload: PublishRequest, request: Request):
    user_id, _ = actor(request)
    try:
        return await (await get_service()).publish(run_id, user_id, payload.asset_ids, payload.canvas_id)
    except Exception as exc:
        store_http_error(exc)


@router.get("/skills")
async def list_agent_skills(request: Request):
    actor(request)
    return {"skills": await (await get_service()).store.list_skills(published_only=True)}


def require_admin(request: Request):
    if not _dependencies.is_admin_request or not _dependencies.is_admin_request(request):
        raise HTTPException(status_code=403, detail="只有平台管理员可以管理 Skill")


@router.post("/skills", status_code=201)
async def create_agent_skill(payload: SkillCreate, request: Request):
    _, username = actor(request)
    require_admin(request)
    return {"skill": await (await get_service()).store.create_skill(payload.slug, payload.name, payload.definition, username)}


@router.post("/skills/{skill_id}/actions")
async def agent_skill_action(skill_id: str, payload: SkillAction, request: Request):
    actor(request)
    require_admin(request)
    try:
        return {"skill": await (await get_service()).store.skill_action(skill_id, payload.action)}
    except Exception as exc:
        store_http_error(exc)


def require_internal_token(token: str):
    expected = os.getenv("AGENT_INTERNAL_TOKEN", "")
    if not expected or not secrets.compare_digest(token, expected):
        raise HTTPException(status_code=403, detail="无效的 Agent 内部令牌")


@router.post("/internal/runs/{run_id}/plan", include_in_schema=False)
async def internal_plan_run(run_id: str, x_agent_internal_token: str = Header(default="", alias="X-Agent-Internal-Token")):
    require_internal_token(x_agent_internal_token)
    try:
        return await (await get_service()).plan_run(run_id)
    except Exception as exc:
        store_http_error(exc)


@router.post("/internal/runs/{run_id}/execute", include_in_schema=False)
async def internal_execute_run(run_id: str, x_agent_internal_token: str = Header(default="", alias="X-Agent-Internal-Token")):
    require_internal_token(x_agent_internal_token)
    try:
        return await (await get_service()).execute_run(run_id)
    except Exception as exc:
        store_http_error(exc)
