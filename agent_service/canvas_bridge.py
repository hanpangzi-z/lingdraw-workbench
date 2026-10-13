from __future__ import annotations

from typing import Any, Dict, Iterable, List, Tuple

from .domain import new_id, now_ms


SMART_CANVAS_DOCUMENT_VERSIONS = {
    "tldraw": 1,
    "fabric": 2,
}


def is_supported_smart_canvas_document(document: Any) -> bool:
    if not isinstance(document, dict):
        return False
    engine = str(document.get("engine") or "")
    return int(document.get("schema_version") or 0) == SMART_CANVAS_DOCUMENT_VERSIONS.get(engine)


def empty_smart_canvas_document() -> Dict[str, Any]:
    return {
        "schema_version": 2,
        "engine": "fabric",
        "snapshot": None,
        "pending_placements": [],
        "applied_placement_ids": [],
        "agent_session": {
            "schema_version": 1,
            "updated_at": 0,
            "conversation_id": "",
            "messages": [],
            "run": None,
            "composer": {
                "prompt": "",
                "mode": "agent",
                "active_skill": "",
            },
        },
    }


def ensure_smart_canvas_document(canvas: Dict[str, Any]) -> Dict[str, Any]:
    document = canvas.get("document")
    if not is_supported_smart_canvas_document(document):
        document = empty_smart_canvas_document()
        canvas["document"] = document
    document.setdefault(
        "schema_version",
        SMART_CANVAS_DOCUMENT_VERSIONS.get(str(document.get("engine") or ""), 2),
    )
    document.setdefault("snapshot", None)
    document.setdefault("pending_placements", [])
    document.setdefault("applied_placement_ids", [])
    document.setdefault("agent_session", empty_smart_canvas_document()["agent_session"])
    return document


def append_canvas_pending_placements(canvas: Dict[str, Any], run: Dict[str, Any],
                                     assets: List[Dict[str, Any]], brief: Dict[str, Any]) -> Dict[str, Any]:
    """Append engine-neutral placements without touching canvas snapshot or legacy node data."""
    document = ensure_smart_canvas_document(canvas)
    pending = document["pending_placements"]
    applied_ids = {str(item) for item in document["applied_placement_ids"]}
    pending_ids = {
        str(item.get("id") or "")
        for item in pending
        if isinstance(item, dict)
    }
    run_id = str(run.get("id") or "")
    objective = str(brief.get("objective") or brief.get("content") or brief.get("title") or "")
    appended: List[str] = []
    for asset in assets:
        asset_id = str(asset.get("id") or "")
        if not asset_id:
            continue
        placement_id = f"agent:{run_id}:{asset_id}"
        if placement_id in applied_ids or placement_id in pending_ids:
            continue
        pending.append({
            "id": placement_id,
            "kind": "design-image",
            "url": str(asset.get("url") or ""),
            "name": str(asset.get("name") or "设计成果"),
            "media_type": str(asset.get("media_type") or "image"),
            "generated_asset_id": asset_id,
            "parent_generated_asset_id": str(asset.get("parent_asset_id") or ""),
            "agent_run_id": run_id,
            "agent_step_id": str(asset.get("step_id") or ""),
            "model": str(asset.get("model") or ""),
            "provider": str(asset.get("provider") or ""),
            "prompt": str((asset.get("params_json") or {}).get("prompt") or objective),
            "created_at": now_ms(),
        })
        appended.append(placement_id)
    return {
        "placement_ids": appended,
        "appended_asset_ids": [item.rsplit(":", 1)[-1] for item in appended],
    }


def find_blank_origin(nodes: Iterable[Dict[str, Any]]) -> Tuple[float, float]:
    visible = [node for node in nodes if isinstance(node, dict)]
    if not visible:
        return 120.0, 120.0
    right = max(float(node.get("x") or 0) + float(node.get("w") or 360) for node in visible)
    top = min(float(node.get("y") or 0) for node in visible)
    return right + 160.0, max(80.0, top)


def build_canvas_bundle(run: Dict[str, Any], assets: List[Dict[str, Any]], brief: Dict[str, Any],
                        existing_nodes: Iterable[Dict[str, Any]], existing_group_id: str = "",
                        anchor_node_id: str = "") -> Dict[str, Any]:
    x, y = find_blank_origin(existing_nodes)
    run_id = str(run.get("id") or "")
    group_id = existing_group_id or new_id("smart")
    prompt_id = new_id("smart")
    objective = str(brief.get("objective") or brief.get("content") or brief.get("title") or "设计智能体 Brief")
    nodes: List[Dict[str, Any]] = []
    connections: List[Dict[str, Any]] = []
    previous_id = anchor_node_id or group_id
    group: Dict[str, Any] | None = None
    if not existing_group_id:
        group = {
            "id": group_id,
            "type": "smart-group",
            "title": "设计智能体成果",
            "x": x,
            "y": y,
            "w": 420,
            "h": 240,
            "items": [prompt_id],
            "images": [],
            "agentRunId": run_id,
            "created_at": now_ms(),
        }
        prompt = {
            "id": prompt_id,
            "type": "smart-prompt",
            "title": "Brief / Prompt",
            "x": x + 460,
            "y": y,
            "w": 360,
            "h": 220,
            "text": objective,
            "prompt": objective,
            "agentRunId": run_id,
            "created_at": now_ms(),
        }
        nodes.extend([group, prompt])
        connections.append({"from": group_id, "to": prompt_id, "kind": "flow"})
        previous_id = prompt_id
    for index, asset in enumerate(assets):
        node_id = new_id("smart")
        item = {
            "url": asset.get("url") or "",
            "name": asset.get("name") or f"设计成果 {index + 1}",
            "kind": asset.get("media_type") or "image",
            "agentRunId": run_id,
            "agentStepId": asset.get("step_id") or "",
            "generatedAssetId": asset.get("id") or "",
        }
        node = {
            "id": node_id,
            "type": "smart-image",
            "title": asset.get("name") or f"设计成果 {index + 1}",
            "x": x + (0 if existing_group_id else 460) + (index % 3) * 380,
            "y": y + (0 if existing_group_id else 280) + (index // 3) * 360,
            "w": 340,
            "h": 300,
            "images": [item],
            "agentRunId": run_id,
            "agentStepId": asset.get("step_id") or "",
            "generatedAssetId": asset.get("id") or "",
            "created_at": now_ms(),
        }
        nodes.append(node)
        if group is not None:
            group["items"].append(node_id)
        connections.append({"from": previous_id, "to": node_id, "kind": "flow"})
        previous_id = node_id
    return {"nodes": nodes, "connections": connections, "group_id": group_id}


def append_canvas_bundle(canvas: Dict[str, Any], run: Dict[str, Any], assets: List[Dict[str, Any]],
                         brief: Dict[str, Any]) -> Dict[str, Any]:
    nodes = canvas.setdefault("nodes", [])
    connections = canvas.setdefault("connections", [])
    run_id = str(run.get("id") or "")
    existing_group = next((
        node for node in nodes
        if isinstance(node, dict) and node.get("agentRunId") == run_id and node.get("type") == "smart-group"
    ), None)
    existing_asset_ids = {
        str(node.get("generatedAssetId") or "")
        for node in nodes
        if isinstance(node, dict) and node.get("agentRunId") == run_id
    }
    pending_assets = [asset for asset in assets if str(asset.get("id") or "") not in existing_asset_ids]
    if not pending_assets:
        return {
            "group_id": str((existing_group or {}).get("id") or ""),
            "appended_asset_ids": [],
        }

    run_nodes = [node for node in nodes if isinstance(node, dict) and node.get("agentRunId") == run_id]
    anchor_id = str((run_nodes[-1] if run_nodes else existing_group or {}).get("id") or "")
    bundle = build_canvas_bundle(
        run,
        pending_assets,
        brief,
        nodes,
        existing_group_id=str((existing_group or {}).get("id") or ""),
        anchor_node_id=anchor_id,
    )
    nodes.extend(bundle["nodes"])
    connections.extend(bundle["connections"])
    if existing_group:
        group_items = existing_group.setdefault("items", [])
        group_items.extend(node["id"] for node in bundle["nodes"] if node["id"] not in group_items)
    return {
        "group_id": str((existing_group or {}).get("id") or bundle["group_id"]),
        "appended_asset_ids": [str(asset.get("id") or "") for asset in pending_assets],
    }
