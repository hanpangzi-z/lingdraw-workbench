from __future__ import annotations

import json
import re
import time
import uuid
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def now_ms() -> int:
    return int(time.time() * 1000)


class AgentRunStatus(str, Enum):
    draft = "draft"
    planning = "planning"
    awaiting_approval = "awaiting_approval"
    running = "running"
    paused = "paused"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class AgentStepStatus(str, Enum):
    pending = "pending"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    skipped = "skipped"
    cancelled = "cancelled"


class ApprovalKind(str, Enum):
    plan = "plan"
    first_result = "first_result"
    publish = "publish"


class ApprovalStatus(str, Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class OutputType(str, Enum):
    image = "image"
    video = "video"
    pptx = "pptx"
    web = "web"


class SkillStatus(str, Enum):
    draft = "draft"
    trial = "trial"
    review = "review"
    published = "published"
    retired = "retired"


class ProjectCreate(BaseModel):
    name: str = Field(default="未命名设计项目", min_length=1, max_length=120)


class VersionedDocumentUpdate(BaseModel):
    version: int = Field(default=0, ge=0)
    payload: Dict[str, Any] = Field(default_factory=dict)


class RunCreate(BaseModel):
    project_id: str = Field(min_length=4, max_length=80)
    output_type: OutputType = OutputType.image
    provider_id: str = Field(default="comfly", max_length=80)
    model: str = Field(default="", max_length=160)
    size: str = Field(default="1024x1024", max_length=40)


class RunAction(BaseModel):
    action: str = Field(pattern=r"^(approve|reject|pause|resume|cancel)$")
    approval_id: str = Field(default="", max_length=80)
    reason: str = Field(default="", max_length=1000)


class RevisionCreate(BaseModel):
    asset_id: str = Field(min_length=4, max_length=80)
    instruction: str = Field(min_length=1, max_length=4000)


class PublishRequest(BaseModel):
    asset_ids: List[str] = Field(min_length=1, max_length=100)
    canvas_id: str = Field(default="", max_length=80)


class SkillCreate(BaseModel):
    slug: str = Field(pattern=r"^[a-z][a-z0-9-]{2,79}$")
    name: str = Field(min_length=1, max_length=120)
    definition: Dict[str, Any] = Field(default_factory=dict)


class SkillAction(BaseModel):
    action: str = Field(pattern=r"^(trial|review|publish|retire)$")


class PlanStepSpec(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    role: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=160)
    instruction: str = Field(min_length=1, max_length=4000)
    capability: str = Field(default="image", max_length=80)
    depends_on: List[str] = Field(default_factory=list, max_length=20)


class RunPlan(BaseModel):
    objective: str = Field(min_length=1, max_length=2000)
    output_type: OutputType = OutputType.image
    steps: List[PlanStepSpec] = Field(min_length=1, max_length=30)


class QualityResult(BaseModel):
    hard_issues: List[str] = Field(default_factory=list)
    scores: Dict[str, int] = Field(default_factory=dict)
    overall_score: int = Field(default=0, ge=0, le=100)
    passed: bool = False
    summary: str = Field(default="", max_length=2000)

    @classmethod
    def normalize(cls, value: Dict[str, Any]) -> "QualityResult":
        scores = {
            str(key)[:80]: max(0, min(100, int(score or 0)))
            for key, score in (value.get("scores") or {}).items()
        }
        overall = max(0, min(100, int(value.get("overall_score") or 0)))
        hard_issues = [str(item)[:500] for item in (value.get("hard_issues") or []) if str(item).strip()]
        mandatory = [scores.get(key, 0) for key in ("brand", "product_fidelity", "clarity") if key in scores]
        passed = not hard_issues and overall >= 80 and all(score >= 70 for score in mandatory)
        return cls(
            hard_issues=hard_issues,
            scores=scores,
            overall_score=overall,
            passed=passed,
            summary=str(value.get("summary") or "")[:2000],
        )


def default_plan(brief: Dict[str, Any], output_type: OutputType = OutputType.image) -> RunPlan:
    objective = str(brief.get("objective") or brief.get("content") or brief.get("title") or "完成设计 Brief")
    return RunPlan(
        objective=objective[:2000],
        output_type=output_type,
        steps=[
            PlanStepSpec(id="creative-direction", role="Creative Director", title="解析 Brief", instruction="提炼目标、受众、交付规格和限制。", capability="planning"),
            PlanStepSpec(id="art-direction", role="Art Director", title="生成视觉方案", instruction=objective[:4000], capability="image", depends_on=["creative-direction"]),
            PlanStepSpec(id="product-fidelity", role="Product Fidelity", title="检查产品一致性", instruction="检查外观、包装文字、颜色和结构。", capability="vision", depends_on=["art-direction"]),
            PlanStepSpec(id="quality-critic", role="Quality Critic", title="质量验收", instruction="检查品牌、文字、清晰度、产品一致性和交付规格。", capability="vision", depends_on=["product-fidelity"]),
        ],
    )


def parse_json_object(text: str) -> Optional[Dict[str, Any]]:
    raw = str(text or "").strip()
    if not raw:
        return None
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.S | re.I)
    candidates = [fenced.group(1)] if fenced else []
    start, end = raw.find("{"), raw.rfind("}")
    if start >= 0 and end > start:
        candidates.append(raw[start:end + 1])
    for candidate in candidates:
        try:
            value = json.loads(candidate)
            if isinstance(value, dict):
                return value
        except Exception:
            continue
    return None
