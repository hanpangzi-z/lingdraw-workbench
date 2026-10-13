import asyncio
import importlib
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
from agent_service.db import AgentStoreError
from agent_service import workbench_analysis
from platform_admin import PlatformStore


agent_api = importlib.import_module("agent_service.api")


class ChatImageRequestTests(unittest.TestCase):
    def test_specialist_workflow_prompts_require_identity_lock_and_forbid_invented_specs(self):
        self.assertIn("产品身份基准", workbench_analysis.PLAN_SYSTEM_PROMPT)
        self.assertIn("规格模块资料不足时必须明确标为待补充", workbench_analysis.PLAN_SYSTEM_PROMPT)
        self.assertIn("用户在生成前可以另选“无文案”版本", workbench_analysis.PLAN_SYSTEM_PROMPT)
        self.assertIn("必须写出确切的主标题", workbench_analysis.PLAN_SYSTEM_PROMPT)
        self.assertIn("任一关键身份特征改变都必须判定 passed=false", workbench_analysis.REVIEW_SYSTEM_PROMPT)
        self.assertIn("plan.workflow_output.copy_mode", workbench_analysis.REVIEW_SYSTEM_PROMPT)
        self.assertIn("跨模块字体一致性", workbench_analysis.REVIEW_SYSTEM_PROMPT)
        self.assertIn("字体体系明显跳变", workbench_analysis.REVIEW_SYSTEM_PROMPT)

    def test_workflow_review_includes_peer_images_and_requires_font_consistency(self):
        payload = workbench_analysis.WorkbenchReviewRequest(
            request_id="workflow-review-font-consistency",
            message="复核整套商品详情页",
            image_url="/assets/current.png",
            image_name="模块4",
            reference_images=[
                {"url": "/assets/product.png", "name": "产品母图"},
            ],
            workflow_reference_images=[
                {"url": "/assets/module-1.png", "name": "模块1"},
                {"url": "/assets/module-5.png", "name": "模块5"},
            ],
        )
        message = json.loads(workbench_analysis.review_user_message(payload))
        self.assertEqual(message["generated_image_index"], 1)
        self.assertEqual(message["reference_materials"][0]["image_index"], 2)
        self.assertEqual(
            [item["image_index"] for item in message["workflow_peer_materials"]],
            [3, 4],
        )

        review = workbench_analysis.WorkbenchResultReview(
            title="套系复核通过",
            summary="当前模块与同批模块保持一致。",
            overall_score=90,
            passed=True,
            highlights=[
                {"title": "产品", "detail": "主体一致。"},
                {"title": "配色", "detail": "主辅色统一。"},
            ],
            checks=[
                {"label": "跨模块字体一致性", "passed": True, "score": 92, "detail": "标题字形、字重和装饰一致。"},
                {"label": "产品一致性", "passed": True, "score": 91, "detail": "包装结构一致。"},
                {"label": "配色一致性", "passed": True, "score": 89, "detail": "橙红主色统一。"},
                {"label": "交付规格", "passed": True, "score": 90, "detail": "比例正确。"},
            ],
            reference_checks=[
                {"reference_index": 1, "verdict": "present", "evidence": "产品位于画面中心。"},
            ],
            conclusion="可以交付。",
            suggestions=[
                {"label": "微调字距", "instruction": "保持字体不变并微调标题字距。"},
                {"label": "统一边距", "instruction": "保持内容不变并统一边距。"},
            ],
        )
        self.assertIs(workbench_analysis.validate_result_review(review, payload), review)

        missing_font_check = review.model_copy(update={
            "checks": [
                item.model_copy(update={"label": "一般视觉检查"})
                if item.label == "跨模块字体一致性" else item
                for item in review.checks
            ],
        })
        with self.assertRaisesRegex(ValueError, "跨模块字体一致性"):
            workbench_analysis.validate_result_review(missing_font_check, payload)

        false_positive = review.model_copy(update={
            "checks": [
                item.model_copy(update={"passed": False, "detail": "标题字体体系明显不同。"})
                if item.label == "跨模块字体一致性" else item
                for item in review.checks
            ],
        })
        with self.assertRaisesRegex(ValueError, "整体复核不得通过"):
            workbench_analysis.validate_result_review(false_positive, payload)

    def test_module_revision_keeps_identity_cost_and_requires_user_confirmation_copy(self):
        original = workbench_analysis.WorkbenchWorkflowModule(
            id="module-1",
            name="原模块",
            purpose="展示卖点",
            content="展示商品与卖点",
            generation_prompt="生成商品卖点模块，保持产品身份和完整交付规格，不要虚构参数。",
            estimated_generation_count=1,
            estimated_points=2,
        )
        payload = workbench_analysis.WorkbenchWorkflowModuleRevisionRequest(
            request_id="revision-request-1",
            message="制作商品详情页",
            original_module=original,
            edited_module=original.model_copy(update={"name": "用户修改模块"}),
        )
        revision = workbench_analysis.WorkbenchWorkflowModuleRevision(
            module=original.model_copy(update={"name": "优化后的模块"}),
            summary="保留用户修改并补足交付约束。",
            cautions=[],
        )
        self.assertIs(workbench_analysis.validate_module_revision(revision, payload), revision)
        self.assertIn("不得推翻或弱化用户刚提交的修改", workbench_analysis.MODULE_REVISION_SYSTEM_PROMPT)
        self.assertIn("不得只要求预留文字区域", workbench_analysis.MODULE_REVISION_SYSTEM_PROMPT)
        invalid = revision.model_copy(update={
            "module": revision.module.model_copy(update={"estimated_points": 3}),
        })
        with self.assertRaisesRegex(ValueError, "不得改变预计积分"):
            workbench_analysis.validate_module_revision(invalid, payload)

    def test_multiple_references_add_an_explicit_coverage_requirement(self):
        prompt = main.image_reference_coverage_prompt("制作商品全家福", [
            {"url": "/assets/box-a.png", "name": "礼盒 A"},
            {"url": "/assets/bag.png", "name": "银色包"},
            {"url": "/assets/box-b.png", "name": "礼盒 B"},
        ])
        self.assertIn("共收到 3 张原始参考图", prompt)
        self.assertIn("参考图1、参考图2、参考图3", prompt)
        self.assertIn("不同商品、不同包装或不同规格必须分别保留", prompt)
        self.assertIn("不得只采用部分参考图", prompt)

    def test_single_reference_keeps_the_original_prompt(self):
        self.assertEqual(
            main.image_reference_coverage_prompt("修改产品背景", [{"url": "/assets/product.png"}]),
            "修改产品背景",
        )


class DesignAgentImageFallbackTests(unittest.TestCase):
    def setUp(self):
        self.comfly = {
            "id": "custom-api",
            "name": "Comfly",
            "base_url": "https://ai.comfly.org",
            "enabled": True,
            "image_models": ["gpt-image-2", "nano-banana-pro"],
        }
        self.cloud_bridge = {
            "id": "custom-api-2",
            "name": "云桥",
            "base_url": "https://api.quya.org/",
            "enabled": True,
            "image_models": ["gpt-image-2"],
        }

    def test_gpt_image_2_keeps_comfly_first_and_falls_back_once(self):
        upstream = AsyncMock(side_effect=[
            HTTPException(status_code=502, detail="Comfly unavailable"),
            {"images": ["/assets/output/fallback.png"], "provider_id": "custom-api-2"},
        ])
        with (
            patch.object(main, "load_api_providers", return_value=[self.comfly, self.cloud_bridge]),
            patch.object(main, "provider_env_key_value", return_value="configured-key"),
            patch.object(main, "build_online_image_result", new=upstream),
        ):
            result = asyncio.run(main.agent_generate_image_adapter({
                "prompt": "product poster",
                "provider_id": "custom-api",
                "model": "gpt-image-2",
                "owner_user_id": 7,
                "owner_username": "member",
            }))

        self.assertEqual(upstream.await_count, 2)
        self.assertEqual(upstream.await_args_list[0].args[0].provider_id, "custom-api")
        self.assertEqual(upstream.await_args_list[1].args[0].provider_id, "custom-api-2")
        self.assertEqual(result["fallback"]["from_provider_id"], "custom-api")
        self.assertEqual(result["fallback"]["to_provider_id"], "custom-api-2")

    def test_successful_primary_route_never_calls_cloud_bridge(self):
        upstream = AsyncMock(return_value={"images": ["/assets/output/primary.png"], "provider_id": "custom-api"})
        with (
            patch.object(main, "load_api_providers", return_value=[self.comfly, self.cloud_bridge]),
            patch.object(main, "provider_env_key_value", return_value="configured-key"),
            patch.object(main, "build_online_image_result", new=upstream),
        ):
            result = asyncio.run(main.agent_generate_image_adapter({
                "prompt": "product poster",
                "provider_id": "custom-api",
                "model": "gpt-image-2",
                "owner_user_id": 7,
            }))

        self.assertEqual(upstream.await_count, 1)
        self.assertEqual(upstream.await_args.args[0].provider_id, "custom-api")
        self.assertNotIn("fallback", result)

    def test_other_models_do_not_fall_back(self):
        upstream = AsyncMock(side_effect=HTTPException(status_code=502, detail="primary failed"))
        with (
            patch.object(main, "load_api_providers", return_value=[self.comfly, self.cloud_bridge]),
            patch.object(main, "provider_env_key_value", return_value="configured-key"),
            patch.object(main, "build_online_image_result", new=upstream),
        ):
            with self.assertRaises(HTTPException):
                asyncio.run(main.agent_generate_image_adapter({
                    "prompt": "product poster",
                    "provider_id": "custom-api",
                    "model": "nano-banana-pro",
                    "owner_user_id": 7,
                }))

        self.assertEqual(upstream.await_count, 1)

    def test_workbench_fallback_resolves_cloud_bridge_gpt_5_5(self):
        with (
            patch.object(main, "load_api_providers", return_value=[self.comfly, self.cloud_bridge]),
            patch.object(main, "provider_env_key_value", return_value="configured-key"),
        ):
            route = main.design_agent_workbench_llm_fallback_route({
                "operation": "workbench-plan",
                "provider": "custom-api",
                "model": "gemini-3-flash-preview",
            })

        self.assertEqual(route, {"provider": "custom-api-2", "model": "gpt-5.5"})

    def test_workbench_fallback_does_not_apply_to_marker_recognition(self):
        with (
            patch.object(main, "load_api_providers", return_value=[self.comfly, self.cloud_bridge]),
            patch.object(main, "provider_env_key_value", return_value="configured-key"),
        ):
            route = main.design_agent_workbench_llm_fallback_route({
                "operation": "workbench-marker-label",
                "provider": "custom-api",
                "model": "gemini-3-flash-preview",
            })

        self.assertIsNone(route)

    def test_workbench_fallback_applies_to_module_revision(self):
        with (
            patch.object(main, "load_api_providers", return_value=[self.comfly, self.cloud_bridge]),
            patch.object(main, "provider_env_key_value", return_value="configured-key"),
        ):
            route = main.design_agent_workbench_llm_fallback_route({
                "operation": "workbench-module-revise",
                "provider": "custom-api",
                "model": "gemini-3-flash-preview",
            })

        self.assertEqual(route, {"provider": "custom-api-2", "model": "gpt-5.5"})


class DesignAgentApiTests(unittest.TestCase):
    def setUp(self):
        from tests.mysql_support import isolated_platform_database
        self.enterContext(isolated_platform_database())
        agent_url=self.enterContext(isolated_platform_database('AGENT_DATABASE_URL'))
        self.enterContext(patch.dict(os.environ,{'AGENT_AUTO_CREATE_SCHEMA':'1','DESIGN_AGENT_ENABLED':'1'}))
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.original_store = main.PLATFORM_STORE
        self.original_conversation_dir = main.CONVERSATION_DIR
        self.original_canvas_dir = main.CANVAS_DIR
        self.original_db_url = os.environ.get("AGENT_DATABASE_URL")
        self.original_mode = os.environ.get("AGENT_ORCHESTRATOR")
        self.original_dependencies = {
            key: getattr(agent_api._dependencies, key)
            for key in ("generate_image", "call_llm", "resolve_llm_fallback", "publish_canvas", "reserve_usage", "settle_usage", "is_admin_request")
        }
        main.PLATFORM_STORE = PlatformStore(self.root / "users.sqlite3", self.root / "legacy.json")
        main.PLATFORM_STORE.initialize()
        main.CONVERSATION_DIR = str(self.root / "conversations")
        main.CANVAS_DIR = str(self.root / "canvases")
        Path(main.CONVERSATION_DIR).mkdir(parents=True, exist_ok=True)
        Path(main.CANVAS_DIR).mkdir(parents=True, exist_ok=True)
        os.environ["AGENT_DATABASE_URL"] = agent_url.set(drivername='mysql+asyncmy').render_as_string(hide_password=False)
        os.environ["AGENT_ORCHESTRATOR"] = "local"
        agent_api._service = None
        agent_api._dependencies.resolve_llm_fallback = None
        self.llm_calls = []

        async def fake_llm(payload):
            self.llm_calls.append(dict(payload))
            system_prompt = str(payload.get("system_prompt") or "")
            if "marker_region_label" in str(payload.get("message") or ""):
                text = json.dumps({
                    "label": "金色龙舟",
                    "description": "裁切区域中心是一艘带金色龙头的龙舟。",
                }, ensure_ascii=False)
            elif "模块编辑复核器" in system_prompt:
                revision_input = json.loads(str(payload.get("message") or "{}"))
                edited = dict(revision_input["user_edited_module"])
                edited["generation_prompt"] = (
                    f"{edited['generation_prompt']} 保持产品身份、整套页面视觉连续和完整交付规格，不得虚构参数。"
                )
                text = json.dumps({
                    "module": edited,
                    "summary": "保留用户修改并补足产品一致性与交付约束。",
                    "cautions": ["未提供的规格参数仍需标为待补充。"],
                }, ensure_ascii=False)
            elif "generation_prompt" in system_prompt:
                route_input = json.loads(str(payload.get("message") or "{}"))
                if route_input.get("brief") == "端午海报" and not route_input.get("clarification_answers") and not route_input.get("skip_clarification"):
                    text = json.dumps({
                        "status": "needs_clarification",
                        "route": "clarify",
                        "reason": "用途和视觉方向仍会显著改变最终构图。",
                        "acknowledgement": "我会为你制作端午主题海报。",
                        "clarification": {
                            "id": "dragon-boat-intake",
                            "introduction": "先确认发布场景和视觉方向，再分配最合适的设计流程。",
                            "questions": [{
                                "id": "visual-direction",
                                "question": "这张端午海报更偏向哪种视觉方向？",
                                "description": "选择会影响主体、构图和色彩。",
                                "selection": "single",
                                "required": True,
                                "recommended_option_id": "modern-minimal",
                                "options": [
                                    {"id": "modern-minimal", "label": "现代简约", "description": "留白、青绿色调与克制排版"},
                                    {"id": "traditional", "label": "传统国风", "description": "书法、纹样与节庆氛围"},
                                    {"id": "commercial", "label": "商业促销", "description": "突出产品与转化信息"},
                                ],
                            }],
                        },
                        "plan": None,
                        "generation_prompt": "",
                    }, ensure_ascii=False)
                else:
                    reference_count = int(route_input.get("reference_count") or 0)
                    reference_analysis = [
                        {
                            "reference_index": index,
                            "subject_name": f"参考商品{index}",
                            "relationship": "independent_subject",
                            "grouped_with_reference_index": None,
                            "must_appear": True,
                            "evidence": f"参考图{index}展示了可独立识别的包装外形。",
                        }
                        for index in range(1, reference_count + 1)
                    ]
                    reference_prompt = "".join(
                        f"参考图{index}作为商品{index}单独保留。"
                        for index in range(1, reference_count + 1)
                    )
                    plan = {
                    "acknowledgement": "我会围绕年轻用户与蓝色产品完成发布主视觉。",
                    "title": "蓝色新品发布视觉方案",
                    "sections": [
                        {"kind": "positioning", "title": "设计定位", "summary": "科技感新品发布", "details": ["突出产品价值"], "colors": []},
                        {"kind": "audience", "title": "受众与钩子", "summary": "面向年轻用户", "details": ["首屏识别产品"], "colors": []},
                        {"kind": "layout", "title": "构图", "summary": "主体居中并保留标题区", "details": ["安全留白"], "colors": []},
                        {"kind": "color", "title": "色彩", "summary": "以蓝色建立科技感", "details": [], "colors": [{"name": "品牌蓝", "value": "#2563EB"}]},
                    ],
                    "generation_prompt": f"生成蓝色新品发布主视觉，产品主体居中，面向年轻用户，保留清晰标题安全区。{reference_prompt}",
                    }
                    text = json.dumps({
                        "status": "ready",
                        "route": "plan_and_generate",
                        "reason": "品牌、受众、参考素材与交付目标足以进入完整设计规划。",
                        "acknowledgement": plan["acknowledgement"],
                        "clarification": None,
                        "plan": plan,
                        "generation_prompt": "",
                        "reference_analysis": reference_analysis,
                    }, ensure_ascii=False)
            elif "suggestions" in system_prompt:
                review_input = json.loads(str(payload.get("message") or "{}"))
                reference_count = int(review_input.get("reference_count") or 0)
                text = json.dumps({
                    "title": "新品主视觉已完成",
                    "summary": "主体清晰，但标题区仍可增强。",
                    "overall_score": 86,
                    "passed": True,
                    "highlights": [
                        {"title": "产品聚焦", "detail": "主体位于视觉中心。"},
                        {"title": "品牌色明确", "detail": "蓝色贯穿背景与光影。"},
                    ],
                    "checks": [
                        {"label": "主体清晰度", "passed": True, "score": 92, "detail": "轮廓清楚。"},
                        {"label": "品牌一致性", "passed": True, "score": 88, "detail": "品牌蓝一致。"},
                        {"label": "文字安全区", "passed": False, "score": 68, "detail": "顶部空间偏紧。"},
                        {"label": "传播效率", "passed": True, "score": 84, "detail": "缩略图可识别。"},
                    ],
                    "reference_checks": [
                        {
                            "reference_index": index,
                            "verdict": "present",
                            "evidence": f"生成结果中可见参考图{index}对应商品。",
                        }
                        for index in range(1, reference_count + 1)
                    ],
                    "conclusion": "可作为首版，建议先增加顶部标题留白。",
                    "suggestions": [
                        {"label": "增加标题留白", "instruction": "将当前图片顶部留白增加 15%，保持产品位置不变。"},
                        {"label": "生成竖版", "instruction": "将当前图片扩展为 4:5 竖版，保持品牌蓝和产品比例。"},
                    ],
                }, ensure_ascii=False)
            elif "Quality Critic" in system_prompt:
                text = json.dumps({
                    "hard_issues": [],
                    "scores": {"brand": 88, "product_fidelity": 91, "clarity": 90},
                    "overall_score": 90,
                    "summary": "通过",
                }, ensure_ascii=False)
            else:
                text = json.dumps({
                    "objective": "制作产品主视觉",
                    "output_type": "image",
                    "steps": [
                        {"id": "creative", "role": "Creative Director", "title": "解析 Brief", "instruction": "解析", "capability": "planning", "depends_on": []},
                        {"id": "art", "role": "Art Director", "title": "生成主视觉", "instruction": "蓝色产品主视觉", "capability": "image", "depends_on": ["creative"]},
                        {"id": "fidelity", "role": "Product Fidelity", "title": "检查产品", "instruction": "检查", "capability": "vision", "depends_on": ["art"]},
                        {"id": "critic", "role": "Quality Critic", "title": "质量验收", "instruction": "验收", "capability": "vision", "depends_on": ["fidelity"]},
                    ],
                }, ensure_ascii=False)
            return {"text": text, "model": "test-llm"}

        async def fake_image(payload):
            return {
                "images": ["/output/agent-test.png"],
                "model": "test-image",
                "params": {"prompt": payload.get("prompt")},
            }

        async def fake_publish(payload):
            return {
                "canvas_id": payload.get("canvas_id") or "canvas_agent_test",
                "group_id": "group_agent_test",
                "asset_library_items": {item["id"]: f"library_{item['id']}" for item in payload.get("assets") or []},
            }

        agent_api.configure_agent_dependencies(
            generate_image=fake_image,
            call_llm=fake_llm,
            publish_canvas=fake_publish,
            reserve_usage=lambda key, username, category, units, operation, model: main.PLATFORM_STORE.reserve_usage_retryable(
                key, username, category, units, operation, model
            ),
            settle_usage=lambda event_id, success, output_units, error: (
                main.PLATFORM_STORE.reconcile_usage_success(event_id, output_units)
                if success else main.PLATFORM_STORE.finish_usage(event_id, False, 0, error)
            ),
            is_admin_request=main.agent_request_is_admin,
        )
        self.client = TestClient(main.app)
        self.client.__enter__()
        self.client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("designer", "password123")
        self.user_id = user["id"]
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 20)
        self.client.post("/api/auth/login", json={"username": "designer", "password": "password123"})

    def tearDown(self):
        if agent_api._service is not None and self.client.portal is not None:
            self.client.portal.call(agent_api._service.store.close)
        self.client.__exit__(None, None, None)
        main.PLATFORM_STORE = self.original_store
        main.CONVERSATION_DIR = self.original_conversation_dir
        main.CANVAS_DIR = self.original_canvas_dir
        agent_api._service = None
        for key, value in self.original_dependencies.items():
            setattr(agent_api._dependencies, key, value)
        if self.original_db_url is None:
            os.environ.pop("AGENT_DATABASE_URL", None)
        else:
            os.environ["AGENT_DATABASE_URL"] = self.original_db_url
        if self.original_mode is None:
            os.environ.pop("AGENT_ORCHESTRATOR", None)
        else:
            os.environ["AGENT_ORCHESTRATOR"] = self.original_mode
        self.temp.cleanup()

    def wait_for_status(self, run_id, expected, timeout=5):
        deadline = time.time() + timeout
        snapshot = None
        while time.time() < deadline:
            response = self.client.get(f"/api/agent/runs/{run_id}")
            self.assertEqual(response.status_code, 200, response.text)
            snapshot = response.json()
            if snapshot["run"]["status"] == expected:
                return snapshot
            time.sleep(0.05)
        self.fail(f"Run {run_id} did not reach {expected}: {snapshot}")

    def test_image_run_approval_and_publish_flow(self):
        project_response = self.client.post("/api/agent/projects", json={"name": "新品主视觉"})
        self.assertEqual(project_response.status_code, 201, project_response.text)
        project_id = project_response.json()["project"]["id"]
        brief = self.client.put(
            f"/api/agent/projects/{project_id}/brief",
            json={"version": 0, "payload": {"objective": "制作蓝色产品主视觉", "audience": "年轻用户"}},
        )
        self.assertEqual(brief.status_code, 200, brief.text)

        created = self.client.post("/api/agent/runs", json={"project_id": project_id, "output_type": "image"})
        self.assertEqual(created.status_code, 202, created.text)
        run_id = created.json()["run"]["id"]
        snapshot = self.wait_for_status(run_id, "awaiting_approval")
        plan_approval = next(item for item in snapshot["approvals"] if item["kind"] == "plan" and item["status"] == "pending")

        approved = self.client.post(
            f"/api/agent/runs/{run_id}/actions",
            json={"action": "approve", "approval_id": plan_approval["id"]},
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        snapshot = self.wait_for_status(run_id, "awaiting_approval")
        self.assertEqual(len(snapshot["assets"]), 1)
        self.assertTrue(snapshot["quality_reports"][-1]["passed"])
        replay = self.client.portal.call(agent_api._service.execute_run, run_id)
        self.assertTrue(replay["idempotent_replay"])
        replay_snapshot = self.client.get(f"/api/agent/runs/{run_id}").json()
        self.assertEqual(len(replay_snapshot["assets"]), 1)
        self.assertEqual(len(replay_snapshot["quality_reports"]), 1)
        first_approval = next(item for item in snapshot["approvals"] if item["kind"] == "first_result" and item["status"] == "pending")

        self.assertEqual(self.client.post(
            f"/api/agent/runs/{run_id}/actions",
            json={"action": "approve", "approval_id": first_approval["id"]},
        ).status_code, 200)
        snapshot = self.client.get(f"/api/agent/runs/{run_id}").json()
        publish_approval = next(item for item in snapshot["approvals"] if item["kind"] == "publish" and item["status"] == "pending")
        self.assertEqual(self.client.post(
            f"/api/agent/runs/{run_id}/actions",
            json={"action": "approve", "approval_id": publish_approval["id"]},
        ).status_code, 200)
        asset_id = snapshot["assets"][0]["id"]
        published = self.client.post(
            f"/api/agent/runs/{run_id}/publish-to-canvas",
            json={"asset_ids": [asset_id]},
        )
        self.assertEqual(published.status_code, 200, published.text)
        self.assertEqual(published.json()["canvas_id"], "canvas_agent_test")
        final_snapshot = self.client.get(f"/api/agent/runs/{run_id}").json()
        self.assertEqual(final_snapshot["run"]["status"], "succeeded")
        self.assertEqual(final_snapshot["run"]["totals_json"]["points"], 3)
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 17)

    def test_workbench_plan_and_review_are_model_generated(self):
        plan_response = self.client.post(
            "/api/agent/workbench/plan",
            json={
                "request_id": "request-plan-1234",
                "message": "为年轻用户制作蓝色新品发布主视觉",
                "skill": "Creative Director",
                "provider": "custom-api",
                "model": "gemini-3.6-flash",
                "brand_kit": {"name": "Demo", "colors": "#2563EB"},
                "reference_images": [
                    {"url": "/assets/input/product-front.png", "name": "产品正面"},
                    {"url": "/assets/input/product-side.png", "name": "产品侧面"},
                ],
            },
        )
        self.assertEqual(plan_response.status_code, 200, plan_response.text)
        decision = plan_response.json()["analysis"]
        self.assertEqual(decision["status"], "ready")
        self.assertEqual(decision["route"], "plan_and_generate")
        plan = decision["plan"]
        self.assertEqual(plan["title"], "蓝色新品发布视觉方案")
        self.assertEqual(plan["sections"][3]["colors"][0]["value"], "#2563EB")
        self.assertEqual(self.llm_calls[-1]["model"], "gemini-3.6-flash")
        self.assertEqual(self.llm_calls[-1]["images"], [
            "/assets/input/product-front.png",
            "/assets/input/product-side.png",
        ])
        plan_input = json.loads(self.llm_calls[-1]["message"])
        self.assertEqual(plan_input["reference_count"], 2)
        self.assertEqual(plan_input["reference_materials"], [
            {"index": 1, "label": "参考图1", "name": "产品正面"},
            {"index": 2, "label": "参考图2", "name": "产品侧面"},
        ])
        self.assertEqual(
            [item["reference_index"] for item in decision["reference_analysis"]],
            [1, 2],
        )
        self.assertIn("参考图1", plan["generation_prompt"])
        self.assertIn("参考图2", plan["generation_prompt"])

        review_response = self.client.post(
            "/api/agent/workbench/review",
            json={
                "request_id": "request-review-1234",
                "message": "为年轻用户制作蓝色新品发布主视觉",
                "skill": "Creative Director",
                "provider": "custom-api",
                "model": "gemini-3.6-flash",
                "image_url": "/assets/output/result.png",
                "image_name": "蓝色新品主视觉",
                "reference_images": [
                    {"url": "/assets/input/product-front.png", "name": "产品正面"},
                    {"url": "/assets/input/product-side.png", "name": "产品侧面"},
                ],
                "plan": plan,
            },
        )
        self.assertEqual(review_response.status_code, 200, review_response.text)
        review = review_response.json()["analysis"]
        self.assertEqual(review["checks"][2]["passed"], False)
        self.assertEqual(
            [item["reference_index"] for item in review["reference_checks"]],
            [1, 2],
        )
        self.assertEqual(review["suggestions"][0]["label"], "增加标题留白")
        self.assertEqual(self.llm_calls[-1]["images"], [
            "/assets/output/result.png",
            "/assets/input/product-front.png",
            "/assets/input/product-side.png",
        ])
        review_input = json.loads(self.llm_calls[-1]["message"])
        self.assertEqual(review_input["generated_image_index"], 1)
        self.assertEqual(review_input["reference_materials"][1], {
            "image_index": 3,
            "label": "参考图2",
            "name": "产品侧面",
        })
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 18)

    def test_workbench_module_revision_is_optimized_and_replayed(self):
        module = {
            "id": "module-hero",
            "name": "首屏模块",
            "purpose": "展示产品定位",
            "content": "展示产品与用户指定卖点",
            "generation_prompt": "生成首屏产品展示模块，使用用户确认的产品与文字内容。",
            "estimated_generation_count": 1,
            "estimated_points": 2,
        }
        payload = {
            "request_id": "module-revision-request-1",
            "message": "制作商品详情页",
            "skill": "商品详情页",
            "provider": "custom-api",
            "model": "gemini-3.6-flash",
            "workflow_plan": {"title": "商品详情页", "modules": [module]},
            "original_module": module,
            "edited_module": {**module, "name": "用户修改的首屏", "content": "突出轻盈佩戴场景"},
        }
        first = self.client.post("/api/agent/workbench/module-revise", json=payload)
        replay = self.client.post("/api/agent/workbench/module-revise", json=payload)

        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(replay.status_code, 200, replay.text)
        revised = first.json()["analysis"]
        self.assertEqual(revised["module"]["id"], module["id"])
        self.assertEqual(revised["module"]["estimated_points"], 2)
        self.assertIn("产品一致性", revised["summary"])
        self.assertEqual(first.json()["analysis"], replay.json()["analysis"])
        revision_input = json.loads(self.llm_calls[-1]["message"])
        self.assertEqual(revision_input["user_edited_module"]["name"], "用户修改的首屏")

    def test_workbench_marker_label_uses_cropped_region_image(self):
        response = self.client.post(
            "/api/agent/workbench/marker-label",
            json={
                "request_id": "request-marker-label-1234",
                "image_url": "/assets/uploads/marker-region.png",
                "target_name": "端午海报",
                "marker_number": 1,
                "x_percent": 63,
                "y_percent": 28,
                "provider": "custom-api",
                "model": "gpt-5.5",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["analysis"]["label"], "金色龙舟")
        self.assertEqual(self.llm_calls[-1]["images"], ["/assets/uploads/marker-region.png"])
        request_message = json.loads(self.llm_calls[-1]["message"])
        self.assertEqual(request_message["original_coordinate"], {
            "x_percent": 63,
            "y_percent": 28,
        })
        self.assertIn("完整连续标题或词组", request_message["instruction"])

    def test_workbench_router_clarifies_then_routes_without_second_charge(self):
        first = self.client.post(
            "/api/agent/workbench/plan",
            json={
                "request_id": "request-route-1234",
                "message": "端午海报",
                "skill": "Instagram Post",
                "provider": "custom-api",
                "model": "gpt-5.5",
            },
        )
        self.assertEqual(first.status_code, 200, first.text)
        first_payload = first.json()
        decision = first_payload["analysis"]
        self.assertEqual(decision["status"], "needs_clarification")
        self.assertEqual(decision["route"], "clarify")
        self.assertEqual(decision["clarification"]["questions"][0]["options"][0]["label"], "现代简约")
        self.assertEqual(first_payload["charged_points"], 1)
        self.assertFalse(first_payload["usage_reused"])
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 19)

        second = self.client.post(
            "/api/agent/workbench/plan",
            json={
                "request_id": "request-route-1234",
                "message": "端午海报",
                "skill": "Instagram Post",
                "provider": "custom-api",
                "model": "gpt-5.5",
                "clarification_id": "dragon-boat-intake",
                "clarification_answers": [{
                    "question_id": "visual-direction",
                    "question": "这张端午海报更偏向哪种视觉方向？",
                    "option_ids": ["modern-minimal"],
                    "values": ["现代简约：留白、青绿色调与克制排版"],
                }],
            },
        )
        self.assertEqual(second.status_code, 200, second.text)
        second_payload = second.json()
        self.assertEqual(second_payload["analysis"]["status"], "ready")
        self.assertEqual(second_payload["analysis"]["route"], "plan_and_generate")
        self.assertEqual(second_payload["charged_points"], 0)
        self.assertTrue(second_payload["usage_reused"])
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 19)
        routed_input = json.loads(self.llm_calls[-1]["message"])
        self.assertEqual(routed_input["brief"], "端午海报")
        self.assertEqual(routed_input["clarification_answers"][0]["option_ids"], ["modern-minimal"])

    def test_workbench_context_fields_cannot_turn_one_request_into_a_free_second_call(self):
        request_id = "request-no-free-context-reuse"
        first = self.client.post("/api/agent/workbench/plan", json={
            "request_id": request_id,
            "message": "生成现代极简蓝色新品海报，主体居中并保留标题安全区",
            "provider": "custom-api",
            "model": "gpt-5.5",
            "canvas_id": "canvas-a",
            "session_id": "session-a",
            "turn_id": "turn-a",
        })
        calls_after_first = len(self.llm_calls)
        balance_after_first = main.PLATFORM_STORE.user_balance(self.user_id)["balance"]
        reused_as_new_context = self.client.post("/api/agent/workbench/plan", json={
            "request_id": request_id,
            "message": "改成红色促销海报并突出五折优惠",
            "provider": "custom-api",
            "model": "gpt-5.5",
            "canvas_id": "canvas-a",
            "session_id": "session-a",
            "turn_id": "turn-b",
            "parent_turn_id": "turn-a",
            "prior_turns": [{"turn_id": "turn-a", "user_request": "蓝色新品海报"}],
            "previous_plan": {"title": "蓝色新品发布视觉方案"},
        })

        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(reused_as_new_context.status_code, 409, reused_as_new_context.text)
        self.assertEqual(
            reused_as_new_context.json()["detail"]["code"], "workbench_request_conflict"
        )
        self.assertEqual(len(self.llm_calls), calls_after_first)
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], balance_after_first)

    def test_workbench_router_retries_transient_disconnect(self):
        original = agent_api._dependencies.call_llm
        attempts = []

        async def flaky_llm(payload):
            attempts.append(dict(payload))
            if len(attempts) < 3:
                raise main.HTTPException(status_code=502, detail="Server disconnected without sending a response.")
            return {
                "model": "gpt-5.5",
                "text": json.dumps({
                    "status": "ready",
                    "route": "direct_generate",
                    "reason": "主体、风格和交付用途已经明确。",
                    "acknowledgement": "直接生成一张明确的新产品海报。",
                    "clarification": None,
                    "plan": None,
                    "generation_prompt": "生成一张现代极简新品海报，主体居中，蓝色背景，保留标题安全区，不要水印。",
                }, ensure_ascii=False),
            }

        agent_api._dependencies.call_llm = flaky_llm
        try:
            response = self.client.post(
                "/api/agent/workbench/plan",
                json={
                    "request_id": "request-retry-1234",
                    "message": "生成现代极简蓝色新品海报，主体居中并保留标题安全区",
                    "provider": "custom-api",
                    "model": "gpt-5.5",
                },
            )
        finally:
            agent_api._dependencies.call_llm = original

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["analysis"]["route"], "direct_generate")
        self.assertEqual(len(attempts), 3)
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 19)

    def test_workbench_multi_reference_validation_reprompts_once_without_extra_charge(self):
        original = agent_api._dependencies.call_llm
        attempts = []

        async def incomplete_then_corrected(payload):
            attempts.append(dict(payload))
            reference_count = 5
            corrected = len(attempts) == 2
            included_count = reference_count if corrected else 4
            prompt = "制作蓝银色商品全家福，" + "".join(
                f"参考图{index}作为独立商品完整呈现。"
                for index in range(1, included_count + 1)
            )
            return {
                "model": "gpt-5.5",
                "text": json.dumps({
                    "status": "ready",
                    "route": "plan_and_generate",
                    "reason": "五张参考图用于商品全家福。",
                    "acknowledgement": "逐图核对并制作商品全家福。",
                    "clarification": None,
                    "reference_analysis": [
                        {
                            "reference_index": index,
                            "subject_name": f"商品{index}",
                            "relationship": "independent_subject",
                            "grouped_with_reference_index": None,
                            "must_appear": True,
                            "evidence": f"参考图{index}具有独立包装结构。",
                        }
                        for index in range(1, included_count + 1)
                    ],
                    "plan": {
                        "acknowledgement": "完整保留五类商品。",
                        "title": "商品全家福",
                        "sections": [
                            {"kind": "layout", "title": "构图", "summary": "分层陈列全部商品。"},
                            {"kind": "color", "title": "色彩", "summary": "蓝银科技配色。"},
                            {"kind": "fidelity", "title": "还原", "summary": "保留包装身份。"},
                        ],
                        "generation_prompt": prompt,
                    },
                    "generation_prompt": "",
                }, ensure_ascii=False),
            }

        agent_api._dependencies.call_llm = incomplete_then_corrected
        try:
            response = self.client.post("/api/agent/workbench/plan", json={
                "request_id": "request-reference-reprompt",
                "message": "把全部商品做成一张全家福海报",
                "provider": "custom-api",
                "model": "gpt-5.5",
                "reference_images": [
                    {"url": f"/assets/input/reference-{index}.png", "name": f"商品{index}"}
                    for index in range(1, 6)
                ],
            })
        finally:
            agent_api._dependencies.call_llm = original

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(attempts), 2)
        self.assertIn("validation_error", json.loads(attempts[1]["message"]))
        self.assertEqual(len(response.json()["analysis"]["reference_analysis"]), 5)
        self.assertEqual(attempts[0]["images"], attempts[1]["images"])
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 19)

    def test_workbench_plan_and_review_replay_after_service_restart(self):
        plan_payload = {
            "request_id": "request-persist-plan-1234",
            "message": "为年轻用户制作蓝色新品发布主视觉",
            "skill": "Creative Director",
            "provider": "custom-api",
            "model": "gemini-3.6-flash",
        }
        first_plan = self.client.post("/api/agent/workbench/plan", json=plan_payload)
        self.assertEqual(first_plan.status_code, 200, first_plan.text)
        self.assertEqual(len(self.llm_calls), 1)
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 19)

        self.client.portal.call(agent_api._service.store.close)
        agent_api._service = None
        replayed_plan = self.client.post("/api/agent/workbench/plan", json=plan_payload)
        self.assertEqual(replayed_plan.status_code, 200, replayed_plan.text)
        self.assertEqual(replayed_plan.json(), first_plan.json())
        self.assertEqual(len(self.llm_calls), 1)
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 19)

        review_payload = {
            "request_id": "request-persist-review-1234",
            "message": plan_payload["message"],
            "skill": plan_payload["skill"],
            "provider": plan_payload["provider"],
            "model": plan_payload["model"],
            "image_url": "/assets/output/result.png",
            "image_name": "蓝色新品主视觉",
            "plan": first_plan.json()["analysis"]["plan"],
        }
        first_review = self.client.post("/api/agent/workbench/review", json=review_payload)
        self.assertEqual(first_review.status_code, 200, first_review.text)
        self.assertEqual(len(self.llm_calls), 2)
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 18)

        self.client.portal.call(agent_api._service.store.close)
        agent_api._service = None
        replayed_review = self.client.post("/api/agent/workbench/review", json=review_payload)
        self.assertEqual(replayed_review.status_code, 200, replayed_review.text)
        self.assertEqual(replayed_review.json(), first_review.json())
        self.assertEqual(len(self.llm_calls), 2)
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 18)

    def test_workbench_review_repairs_reference_checks_twice_before_failing(self):
        original = agent_api._dependencies.call_llm
        calls = []

        def review_json(reference_checks):
            return json.dumps({
                "title": "商品复核",
                "summary": "逐项检查生成结果。",
                "overall_score": 88,
                "passed": True,
                "highlights": [
                    {"title": "构图", "detail": "主体层次清楚。"},
                    {"title": "配色", "detail": "品牌色保持一致。"},
                ],
                "checks": [
                    {"label": "商品", "passed": True, "score": 90, "detail": "商品可识别。"},
                    {"label": "品牌", "passed": True, "score": 88, "detail": "标识清楚。"},
                    {"label": "构图", "passed": True, "score": 87, "detail": "层次合理。"},
                    {"label": "交付", "passed": True, "score": 86, "detail": "规格可用。"},
                ],
                "reference_checks": reference_checks,
                "conclusion": "可以交付。",
                "suggestions": [
                    {"label": "微调光线", "instruction": "轻微提高主体亮度。"},
                    {"label": "保留版本", "instruction": "保留当前构图作为主版本。"},
                ],
            }, ensure_ascii=False)

        async def invalid_twice_then_complete(payload):
            calls.append(dict(payload))
            reference_checks = [] if len(calls) < 3 else [{
                "reference_index": 1,
                "verdict": "present",
                "evidence": "生成结果左侧可见参考图1对应的蓝色礼盒。",
            }]
            return {"text": review_json(reference_checks), "model": "test-reviewer"}

        agent_api._dependencies.call_llm = invalid_twice_then_complete
        try:
            response = self.client.post("/api/agent/workbench/review", json={
                "request_id": "request-review-correction-loop",
                "message": "生成蓝色礼盒全家福",
                "provider": "custom-api",
                "model": "gemini-3.6-flash",
                "image_url": "/assets/output/result.png",
                "image_name": "蓝色礼盒全家福",
                "reference_images": [{
                    "url": "/assets/input/box.png",
                    "name": "蓝色礼盒",
                }],
                "plan": {"reference_analysis": [{
                    "reference_index": 1,
                    "must_appear": True,
                }]},
            })
        finally:
            agent_api._dependencies.call_llm = original

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(calls), 3)
        self.assertIn("validation_error", json.loads(calls[1]["message"]))
        self.assertEqual(json.loads(calls[2]["message"])["correction_attempt"], 2)
        self.assertEqual(response.json()["analysis"]["reference_checks"][0]["reference_index"], 1)
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 19)

    def test_workbench_review_validation_failure_falls_back_to_cloud_bridge(self):
        original = agent_api._dependencies.call_llm
        original_resolver = agent_api._dependencies.resolve_llm_fallback
        calls = []

        async def invalid_primary_valid_fallback(payload):
            calls.append(dict(payload))
            result = await original(payload)
            review = json.loads(result["text"])
            if payload["model"] == "gemini-3-flash-preview":
                review["reference_checks"] = []
            else:
                review["reference_checks"] = [{
                    "reference_index": 1,
                    "verdict": "present",
                    "evidence": "生成结果中可见参考图1对应的蓝色礼盒，位置和包装特征明确。",
                }]
            return {"text": json.dumps(review, ensure_ascii=False), "model": payload["model"]}

        agent_api._dependencies.call_llm = invalid_primary_valid_fallback
        agent_api._dependencies.resolve_llm_fallback = lambda _payload: {
            "provider": "custom-api-2", "model": "gpt-5.5",
        }
        try:
            response = self.client.post("/api/agent/workbench/review", json={
                "request_id": "request-review-validation-fallback",
                "message": "生成蓝色礼盒全家福",
                "provider": "custom-api",
                "model": "gemini-3-flash-preview",
                "image_url": "/assets/output/result.png",
                "image_name": "蓝色礼盒全家福",
                "reference_images": [{
                    "url": "/assets/input/box.png",
                    "name": "蓝色礼盒",
                }],
                "plan": {"reference_analysis": [{
                    "reference_index": 1,
                    "must_appear": True,
                }]},
            })
        finally:
            agent_api._dependencies.call_llm = original
            agent_api._dependencies.resolve_llm_fallback = original_resolver

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            [(item["provider"], item["model"]) for item in calls],
            [
                ("custom-api", "gemini-3-flash-preview"),
                ("custom-api", "gemini-3-flash-preview"),
                ("custom-api", "gemini-3-flash-preview"),
                ("custom-api-2", "gpt-5.5"),
            ],
        )
        self.assertEqual(response.json()["model"], "gpt-5.5")
        self.assertEqual(response.json()["fallback"]["reason"], "validation_failed")
        self.assertEqual(response.json()["fallback"]["to_provider"], "custom-api-2")
        self.assertEqual(response.json()["analysis"]["reference_checks"][0]["reference_index"], 1)
        fallback_message = json.loads(calls[-1]["message"])
        self.assertTrue(fallback_message["fallback_after_validation"])
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 19)

    def test_workbench_request_id_conflict_does_not_call_model_or_charge(self):
        payload = {
            "request_id": "request-conflict-1234",
            "message": "为年轻用户制作蓝色新品发布主视觉",
            "provider": "custom-api",
            "model": "gemini-3.6-flash",
        }
        first = self.client.post("/api/agent/workbench/plan", json=payload)
        self.assertEqual(first.status_code, 200, first.text)
        conflict = self.client.post(
            "/api/agent/workbench/plan",
            json={**payload, "message": "改成红色传统节庆海报"},
        )
        self.assertEqual(conflict.status_code, 409, conflict.text)
        self.assertEqual(conflict.json()["detail"]["code"], "workbench_request_conflict")
        self.assertEqual(len(self.llm_calls), 1)
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 19)

    def test_failed_workbench_request_can_retry_same_fingerprint(self):
        original = agent_api._dependencies.call_llm
        calls = []

        async def fail_once(payload):
            calls.append(dict(payload))
            if len(calls) == 1:
                raise main.HTTPException(status_code=400, detail="invalid analysis response")
            return await original(payload)

        payload = {
            "request_id": "request-failed-retry-1234",
            "message": "为年轻用户制作蓝色新品发布主视觉",
            "provider": "custom-api",
            "model": "gemini-3.6-flash",
        }
        agent_api._dependencies.call_llm = fail_once
        try:
            failed = self.client.post("/api/agent/workbench/plan", json=payload)
            retried = self.client.post("/api/agent/workbench/plan", json=payload)
        finally:
            agent_api._dependencies.call_llm = original

        self.assertEqual(failed.status_code, 400, failed.text)
        self.assertEqual(retried.status_code, 200, retried.text)
        self.assertEqual(len(calls), 2)
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 19)

    def test_plan_failure_falls_back_to_cloud_bridge_gpt_5_5_once(self):
        request = httpx.Request("POST", "https://ai.comfly.org/v1/chat/completions")
        response = httpx.Response(
            429,
            request=request,
            headers={"Retry-After": "8"},
            json={"error": {"code": "rate_limit_exceeded", "message": "rate limited"}},
        )
        primary_error = main.upstream_http_exception(
            httpx.HTTPStatusError(
                "429 Too Many Requests", request=request, response=response,
            ),
            {"id": "custom-api"},
            "gemini-3-flash-preview",
        )
        original = agent_api._dependencies.call_llm
        calls = []

        async def fallback_llm(payload):
            calls.append(dict(payload))
            if payload["model"] == "gemini-3-flash-preview":
                raise primary_error
            result = await original(payload)
            return {**result, "model": payload["model"]}

        payload = {
            "request_id": "request-comfly-luna-fallback",
            "message": "Create a modern summer campaign poster with a blue product centered.",
            "provider": "custom-api",
            "model": "gemini-3-flash-preview",
        }
        agent_api._dependencies.call_llm = fallback_llm
        agent_api._dependencies.resolve_llm_fallback = lambda _payload: {
            "provider": "custom-api-2", "model": "gpt-5.5",
        }
        try:
            first = self.client.post("/api/agent/workbench/plan", json=payload)
            replay = self.client.post("/api/agent/workbench/plan", json=payload)
        finally:
            agent_api._dependencies.call_llm = original

        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["model"], "gpt-5.5")
        self.assertEqual(first.json()["fallback"]["to_provider"], "custom-api-2")
        self.assertEqual(first.json()["fallback"]["to_model"], "gpt-5.5")
        self.assertEqual(replay.json(), first.json())
        self.assertEqual(
            [(item["provider"], item["model"]) for item in calls],
            [("custom-api", "gemini-3-flash-preview"), ("custom-api-2", "gpt-5.5")],
        )
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 19)

        service = self.client.portal.call(agent_api.get_service)
        stored = self.client.portal.call(
            service.store.get_workbench_request,
            self.user_id,
            "workbench-plan",
            payload["request_id"],
        )
        self.assertEqual(stored["status"], "succeeded")
        self.assertEqual(stored["result_json"]["model"], "gpt-5.5")
        self.assertEqual(stored["result_json"]["fallback"]["to_provider"], "custom-api-2")
        self.assertNotIn("diagnostic", stored["result_json"])

    def test_explicit_workbench_model_does_not_silently_fallback(self):
        request = httpx.Request("POST", "https://ai.comfly.org/v1/chat/completions")
        response = httpx.Response(
            429,
            request=request,
            json={"error": {"code": "rate_limit_exceeded", "message": "rate limited"}},
        )
        primary_error = main.upstream_http_exception(
            httpx.HTTPStatusError(
                "429 Too Many Requests", request=request, response=response,
            ),
            {"id": "custom-api"},
            "gpt-5.6-terra",
        )
        original_llm = agent_api._dependencies.call_llm
        original_resolver = agent_api._dependencies.resolve_llm_fallback
        calls = []

        async def fail_selected_model(payload):
            calls.append(dict(payload))
            raise primary_error

        agent_api._dependencies.call_llm = fail_selected_model
        agent_api._dependencies.resolve_llm_fallback = lambda _payload: {
            "provider": "custom-api-2", "model": "doubao-seed-2-0-mini-260215",
        }
        try:
            failed = self.client.post("/api/agent/workbench/plan", json={
                "request_id": "request-explicit-analysis-model",
                "message": "Create a complete modern product campaign poster.",
                "provider": "custom-api",
                "model": "gpt-5.6-terra",
                "allow_model_fallback": False,
            })
        finally:
            agent_api._dependencies.call_llm = original_llm
            agent_api._dependencies.resolve_llm_fallback = original_resolver

        self.assertEqual(failed.status_code, 429, failed.text)
        self.assertEqual(
            [(item["provider"], item["model"]) for item in calls],
            [("custom-api", "gpt-5.6-terra")],
        )
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 20)

    def test_review_failure_uses_same_cloud_bridge_fallback(self):
        request = httpx.Request("POST", "https://ai.comfly.org/v1/chat/completions")
        response = httpx.Response(
            503,
            request=request,
            json={"error": {"code": "service_unavailable", "message": "unavailable"}},
        )
        primary_error = main.upstream_http_exception(
            httpx.HTTPStatusError(
                "503 Service Unavailable", request=request, response=response,
            ),
            {"id": "custom-api"},
            "gemini-3-flash-preview",
        )
        original = agent_api._dependencies.call_llm
        calls = []

        async def fallback_llm(payload):
            calls.append(dict(payload))
            if payload["model"] == "gemini-3-flash-preview":
                raise primary_error
            result = await original(payload)
            return {**result, "model": payload["model"]}

        agent_api._dependencies.call_llm = fallback_llm
        agent_api._dependencies.resolve_llm_fallback = lambda _payload: {
            "provider": "custom-api-2", "model": "gpt-5.5",
        }
        try:
            review = self.client.post("/api/agent/workbench/review", json={
                "request_id": "request-review-luna-fallback",
                "message": "Review the generated summer campaign poster.",
                "provider": "custom-api",
                "model": "gemini-3-flash-preview",
                "image_url": "/assets/output/result.png",
                "image_name": "summer campaign poster",
            })
        finally:
            agent_api._dependencies.call_llm = original

        self.assertEqual(review.status_code, 200, review.text)
        self.assertEqual(review.json()["model"], "gpt-5.5")
        self.assertEqual(review.json()["fallback"]["to_provider"], "custom-api-2")
        self.assertEqual(
            [(item["provider"], item["model"]) for item in calls],
            [("custom-api", "gemini-3-flash-preview"), ("custom-api-2", "gpt-5.5")],
        )
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 19)

    def test_primary_auth_failure_can_fall_back_to_independent_cloud_bridge_key(self):
        request = httpx.Request("POST", "https://ai.comfly.org/v1/chat/completions")
        response = httpx.Response(
            401,
            request=request,
            json={"error": {"code": "invalid_api_key", "message": "unauthorized"}},
        )
        auth_error = main.upstream_http_exception(
            httpx.HTTPStatusError(
                "401 Unauthorized", request=request, response=response,
            ),
            {"id": "custom-api"},
            "gemini-3-flash-preview",
        )
        original = agent_api._dependencies.call_llm
        calls = []

        async def fail_auth(payload):
            calls.append(dict(payload))
            if payload["provider"] == "custom-api":
                raise auth_error
            result = await original(payload)
            return {**result, "model": payload["model"]}

        agent_api._dependencies.call_llm = fail_auth
        agent_api._dependencies.resolve_llm_fallback = lambda _payload: {
            "provider": "custom-api-2", "model": "gpt-5.5",
        }
        try:
            response = self.client.post("/api/agent/workbench/plan", json={
                "request_id": "request-comfly-auth-no-fallback",
                "message": "Create a complete modern product campaign poster.",
                "provider": "custom-api",
                "model": "gemini-3-flash-preview",
            })
        finally:
            agent_api._dependencies.call_llm = original

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["model"], "gpt-5.5")
        self.assertEqual(
            [(item["provider"], item["model"]) for item in calls],
            [("custom-api", "gemini-3-flash-preview"), ("custom-api-2", "gpt-5.5")],
        )
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 19)

    def test_transport_failure_retries_primary_then_falls_back_once(self):
        request = httpx.Request("POST", "https://ai.comfly.org/v1/chat/completions")
        transport_error = main.upstream_transport_exception(
            httpx.ConnectTimeout("timeout", request=request),
            {"id": "custom-api"},
            "gemini-3-flash-preview",
        )
        original = agent_api._dependencies.call_llm
        calls = []

        async def fail_transport(payload):
            calls.append(dict(payload))
            if payload["provider"] == "custom-api":
                raise transport_error
            result = await original(payload)
            return {**result, "model": payload["model"]}

        agent_api._dependencies.call_llm = fail_transport
        agent_api._dependencies.resolve_llm_fallback = lambda _payload: {
            "provider": "custom-api-2", "model": "gpt-5.5",
        }
        try:
            response = self.client.post("/api/agent/workbench/plan", json={
                "request_id": "request-comfly-transport-no-fallback",
                "message": "Create a complete modern product campaign poster.",
                "provider": "custom-api",
                "model": "gemini-3-flash-preview",
            })
        finally:
            agent_api._dependencies.call_llm = original

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["model"], "gpt-5.5")
        self.assertEqual(len(calls), 4)
        self.assertFalse(all(
            item["model"] == "gemini-3-flash-preview" for item in calls
        ))
        self.assertEqual([item["provider"] for item in calls[:3]], ["custom-api"] * 3)
        self.assertEqual((calls[-1]["provider"], calls[-1]["model"]), ("custom-api-2", "gpt-5.5"))
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 19)

    def test_workbench_analysis_timeout_fails_bounded_without_charging(self):
        original = agent_api._dependencies.call_llm

        async def never_returns(_payload):
            await asyncio.sleep(1)
            raise AssertionError("unreachable")

        agent_api._dependencies.call_llm = never_returns
        try:
            with patch.dict(os.environ, {"WORKBENCH_LLM_TIMEOUT_SECONDS": "0.05"}):
                failed = self.client.post("/api/agent/workbench/plan", json={
                    "request_id": "request-workbench-timeout",
                    "message": "Create a complete modern product campaign poster.",
                    "provider": "custom-api",
                    "model": "gemini-3-flash-preview",
                })
        finally:
            agent_api._dependencies.call_llm = original

        self.assertEqual(failed.status_code, 504, failed.text)
        self.assertEqual(failed.json()["detail"]["code"], "upstream_transport_error")
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 20)

    def test_upstream_http_failure_persists_only_sanitized_diagnostics(self):
        request = httpx.Request("POST", "https://ai.comfly.org/v1/chat/completions")
        response = httpx.Response(
            429,
            request=request,
            headers={"Retry-After": "12", "X-Request-ID": "comfly-request-123"},
            json={
                "error": {
                    "code": "rate_limit_exceeded",
                    "type": "requests",
                    "message": (
                        "rate limit hit; Authorization: Bearer top-secret-token "
                        "data:image/png;base64,ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
                    ),
                },
            },
        )
        source_error = httpx.HTTPStatusError(
            "429 Too Many Requests", request=request, response=response,
        )
        with patch("builtins.print") as print_mock:
            public_error = main.upstream_http_exception(
                source_error, {"id": "comfly"}, "gpt-5.6-luna",
            )
        printed = " ".join(str(call) for call in print_mock.call_args_list)
        self.assertNotIn("top-secret-token", printed)
        self.assertNotIn("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", printed)

        original = agent_api._dependencies.call_llm

        async def fail_with_diagnostic(_payload):
            raise public_error

        payload = {
            "request_id": "request-upstream-diagnostic-1234",
            "message": "Create a summer poster",
            "provider": "comfly",
            "model": "gpt-5.6-luna",
        }
        agent_api._dependencies.call_llm = fail_with_diagnostic
        try:
            failed = self.client.post("/api/agent/workbench/plan", json=payload)
        finally:
            agent_api._dependencies.call_llm = original

        self.assertEqual(failed.status_code, 429, failed.text)
        detail = failed.json()["detail"]
        self.assertEqual(detail["code"], "upstream_rate_limited")
        self.assertEqual(detail["upstream_status"], 429)
        self.assertTrue(detail["diagnostic_id"].startswith("upstream-"))

        service = self.client.portal.call(agent_api.get_service)
        stored = self.client.portal.call(
            service.store.get_workbench_request,
            self.user_id,
            "workbench-plan",
            payload["request_id"],
        )
        diagnostic = stored["result_json"]["diagnostic"]
        self.assertEqual(diagnostic["diagnostic_id"], detail["diagnostic_id"])
        self.assertEqual(diagnostic["operation"], "workbench-plan")
        self.assertEqual(diagnostic["request_id"], payload["request_id"])
        self.assertEqual(diagnostic["provider"], "comfly")
        self.assertEqual(diagnostic["model"], payload["model"])
        self.assertEqual(diagnostic["upstream_status"], 429)
        self.assertEqual(diagnostic["upstream_code"], "rate_limit_exceeded")
        self.assertEqual(diagnostic["retry_after"], "12")
        self.assertEqual(diagnostic["upstream_request_id"], "comfly-request-123")
        serialized = json.dumps(stored, ensure_ascii=False)
        self.assertNotIn("top-secret-token", serialized)
        self.assertNotIn("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", serialized)

    def test_upstream_transport_failure_has_safe_diagnostic_identity(self):
        request = httpx.Request("POST", "https://ai.comfly.org/v1/chat/completions")
        source_error = httpx.ConnectTimeout(
            "timeout; Authorization: Bearer transport-secret-token",
            request=request,
        )
        with patch("builtins.print") as print_mock:
            public_error = main.upstream_transport_exception(
                source_error, {"id": "comfly"}, "gemini-3-flash-preview",
            )

        self.assertEqual(public_error.status_code, 502)
        self.assertEqual(public_error.detail["code"], "upstream_transport_error")
        self.assertEqual(public_error.detail["upstream_status"], 0)
        self.assertTrue(public_error.detail["diagnostic_id"].startswith("upstream-"))
        diagnostic = public_error.upstream_diagnostic
        self.assertEqual(diagnostic["upstream_code"], "transport_error")
        self.assertEqual(diagnostic["upstream_type"], "ConnectTimeout")
        self.assertNotIn("transport-secret-token", json.dumps(diagnostic))
        self.assertNotIn(
            "transport-secret-token",
            " ".join(str(call) for call in print_mock.call_args_list),
        )

    def test_fresh_running_workbench_request_rejects_duplicate(self):
        payload = agent_api.WorkbenchPlanRequest(
            request_id="request-running-1234",
            message="为年轻用户制作蓝色新品发布主视觉",
            provider="custom-api",
            model="gemini-3.6-flash",
        )
        message = agent_api.plan_user_message(payload)
        fingerprint = agent_api.workbench_request_fingerprint(
            payload.provider, payload.model, message, [],
        )
        service = self.client.portal.call(agent_api.get_service)
        self.client.portal.call(
            service.store.claim_workbench_request,
            self.user_id,
            "workbench-plan",
            payload.request_id,
            fingerprint,
            payload.provider,
            payload.model,
            "another-live-process",
        )
        duplicate = self.client.post(
            "/api/agent/workbench/plan",
            json=payload.model_dump(),
        )
        self.assertEqual(duplicate.status_code, 409, duplicate.text)
        self.assertEqual(duplicate.json()["detail"]["code"], "workbench_request_in_progress")
        self.assertEqual(len(self.llm_calls), 0)
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 20)

    def test_workbench_restart_reclaims_old_executor_and_rejects_stale_finish(self):
        service = self.client.portal.call(agent_api.get_service)
        request_id = "request-restart-lease-1234"
        fingerprint = agent_api.workbench_request_fingerprint(
            "custom-api", "gemini-3.6-flash", "restart lease", [],
        )
        first = self.client.portal.call(
            service.store.claim_workbench_request,
            self.user_id, "workbench-plan", request_id, fingerprint,
            "custom-api", "gemini-3.6-flash", "old-process",
        )
        second = self.client.portal.call(
            service.store.claim_workbench_request,
            self.user_id, "workbench-plan", request_id, fingerprint,
            "custom-api", "gemini-3.6-flash", "new-process", 0,
        )
        first_token = first["request"]["result_json"]["_claim_token"]
        second_token = second["request"]["result_json"]["_claim_token"]

        self.assertEqual(second["action"], "execute")
        self.assertNotEqual(first_token, second_token)
        with self.assertRaises(AgentStoreError) as context:
            self.client.portal.call(
                service.store.finish_workbench_request,
                self.user_id, "workbench-plan", request_id, fingerprint,
                "failed", None, "stale failure", first_token,
            )
        self.assertEqual(context.exception.code, "workbench_request_lease_lost")

    def test_reused_reserved_workbench_usage_is_released_when_recovery_fails(self):
        request_id = "request-reused-reservation-fails"
        usage_key = f"workbench:{self.user_id}:{request_id}:workbench-plan"
        usage_event_id, created = main.PLATFORM_STORE.reserve_usage_retryable(
            usage_key, "designer", "chat", 1, "workbench-plan", "gpt-5.5"
        )
        self.assertTrue(created)
        original = agent_api._dependencies.call_llm

        async def fail(_payload):
            raise main.HTTPException(status_code=400, detail="invalid analysis response")

        agent_api._dependencies.call_llm = fail
        try:
            failed = self.client.post("/api/agent/workbench/plan", json={
                "request_id": request_id,
                "message": "生成一张蓝色新品海报",
                "provider": "custom-api",
                "model": "gpt-5.5",
            })
        finally:
            agent_api._dependencies.call_llm = original

        self.assertEqual(failed.status_code, 400, failed.text)
        usage = main.PLATFORM_STORE.usage_by_idempotency_key(usage_key)
        self.assertEqual(usage["id"], usage_event_id)
        self.assertEqual(usage["status"], "failed")
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["available"], 20)

    def test_succeeded_workbench_result_repairs_reserved_billing_on_replay(self):
        service = self.client.portal.call(agent_api.get_service)
        payload = agent_api.WorkbenchPlanRequest(
            request_id="request-success-before-settle",
            message="生成一张蓝色新品海报",
            provider="custom-api",
            model="gpt-5.5",
        )
        message = agent_api.plan_user_message(payload)
        fingerprint = agent_api.workbench_request_fingerprint(
            payload.provider, payload.model, message, [],
        )
        claimed = self.client.portal.call(
            service.store.claim_workbench_request,
            self.user_id, "workbench-plan", payload.request_id, fingerprint,
            payload.provider, payload.model, "crashed-process",
        )
        claim_token = claimed["request"]["result_json"]["_claim_token"]
        usage_key = f"workbench:{self.user_id}:{payload.request_id}:workbench-plan"
        usage_event_id, created = main.PLATFORM_STORE.reserve_usage_retryable(
            usage_key, "designer", "chat", 1, "workbench-plan", payload.model,
        )
        self.assertTrue(created)
        stored_response = {
            "analysis": {
                "status": "ready",
                "route": "direct_generate",
                "reason": "交付目标与视觉方向已经明确。",
                "acknowledgement": "将直接生成新品海报。",
                "clarification": None,
                "plan": None,
                "generation_prompt": "生成一张现代极简蓝色新品海报，主体居中，保留标题安全区，不要水印。",
            },
            "model": payload.model,
            "charged_points": 0,
            "usage_reused": False,
            "_usage_event_id": usage_event_id,
            "_claim_token": claim_token,
            "_usage_was_reserved": True,
            "billing_pending": True,
        }
        self.client.portal.call(
            service.store.finish_workbench_request,
            self.user_id, "workbench-plan", payload.request_id, fingerprint,
            "succeeded", stored_response, "", claim_token,
        )

        # Simulate the exact crash window: the usage transaction committed, but
        # the Workbench result was not patched before the process stopped.
        settled = main.PLATFORM_STORE.reconcile_usage_success(usage_event_id, 1)
        self.assertTrue(settled["_settled_now"])
        self.client.portal.call(agent_api.recover_pending_workbench_billing, service.store)

        first = self.client.post("/api/agent/workbench/plan", json=payload.model_dump())
        second = self.client.post("/api/agent/workbench/plan", json=payload.model_dump())

        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["charged_points"], 1)
        self.assertNotIn("billing_pending", first.json())
        self.assertEqual(second.json(), first.json())
        self.assertEqual(len(self.llm_calls), 0)
        self.assertEqual(main.PLATFORM_STORE.usage_by_idempotency_key(usage_key)["status"], "succeeded")
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], 19)

    def test_workbench_plan_serializes_recent_turns_and_edit_context(self):
        payload = agent_api.WorkbenchPlanRequest(
            request_id="request-multiturn-context",
            message="把标题移入印刷安全区",
            canvas_id="canvas-a",
            session_id="session-a",
            turn_id="turn-8",
            parent_turn_id="turn-7",
            mode_hint="suggestion",
            selected_assets=[{
                "id": "asset-child",
                "url": "/output/poster.png",
                "parent_asset_id": "asset-parent",
            }],
            prior_turns=[
                {"turn_id": f"turn-{index}", "summary": f"第 {index} 轮"}
                for index in range(1, 7)
            ],
            previous_plan={"title": "端午海报方案"},
            previous_review={"overall_score": 82, "conclusion": "标题安全区偏紧"},
        )

        message = json.loads(agent_api.plan_user_message(payload))
        self.assertEqual(message["canvas_id"], "canvas-a")
        self.assertEqual(message["parent_turn_id"], "turn-7")
        self.assertEqual([item["turn_id"] for item in message["prior_turns"]], [
            "turn-1", "turn-2", "turn-3", "turn-4", "turn-5", "turn-6",
        ])
        self.assertEqual(message["selected_assets"][0]["parent_asset_id"], "asset-parent")
        self.assertEqual(message["previous_plan"]["title"], "端午海报方案")
        self.assertEqual(message["previous_review"]["overall_score"], 82)

    def test_workbench_edit_route_accepts_selected_asset_and_clarify_cannot_execute(self):
        payload = agent_api.WorkbenchPlanRequest(
            request_id="request-selected-asset-edit",
            message="把标题向内收，避开印刷安全区",
            selected_assets=[{"id": "asset-1", "url": "/output/poster.png"}],
        )
        editable = agent_api.WorkbenchRoutingDecision(
            status="ready",
            route="edit_image",
            reason="父成果和修改位置均已明确。",
            acknowledgement="将保留原图并创建印刷安全区子版本。",
            clarification=None,
            plan=None,
            generation_prompt="保持原海报主体、风格和配色不变，将所有标题文字向画面内侧移动并留出明确印刷安全区。",
        )
        self.assertIs(agent_api.validate_routing_decision(editable, payload), editable)

        invalid_clarification = agent_api.WorkbenchRoutingDecision(
            status="needs_clarification",
            route="clarify",
            reason="高级感存在多个明显不同方向。",
            acknowledgement="需要确认高级感的具体方向。",
            clarification={
                "id": "premium-direction",
                "introduction": "不同方向会改变材质、排版和光影。",
                "questions": [{
                    "id": "style",
                    "question": "希望采用哪一种高级感？",
                    "description": "请选择更接近目标的方向。",
                    "selection": "single",
                    "required": True,
                    "recommended_option_id": "minimal",
                    "options": [
                        {"id": "minimal", "label": "极简奢华", "description": "留白与克制材质"},
                        {"id": "dramatic", "label": "戏剧光影", "description": "强对比与高质感光线"},
                    ],
                }],
            },
            plan=None,
            generation_prompt="这段执行提示词在澄清阶段不应存在。",
        )
        with self.assertRaisesRegex(ValueError, "澄清路径不得携带"):
            agent_api.validate_routing_decision(invalid_clarification, payload)

    def test_product_detail_workflow_is_dynamic_and_requires_consistent_totals(self):
        payload = agent_api.WorkbenchPlanRequest(
            request_id="request-product-detail-workflow",
            message="为这款商品规划完整详情页",
            skill="商品详情页",
        )
        modules = [
            {
                "id": f"module-{index}",
                "name": f"模块 {index}",
                "purpose": "承担详情页叙事中的独立作用",
                "content": "围绕当前商品与平台目标组织可见信息",
                "generation_prompt": f"生成详情页模块 {index}，保持产品、品牌、配色和整套页面视觉连续，并满足清晰交付规格。",
                "estimated_generation_count": 1,
                "estimated_points": 1,
            }
            for index in range(1, 7)
        ]
        decision = agent_api.WorkbenchRoutingDecision(
            status="ready",
            route="specialist_workflow",
            reason="详情页需要多个连续模块共同交付。",
            acknowledgement="先确认动态规划出的详情页模块。",
            workflow_plan={
                "skill_slug": "product-detail-page",
                "workflow_version": 1,
                "title": "通用商品详情页",
                "summary": "六个模块按卖点顺序形成连续叙事。",
                "modules": modules,
                "estimated_generation_count": 6,
                "estimated_points": 6,
            },
        )
        self.assertIs(agent_api.validate_routing_decision(decision, payload), decision)

        decision.workflow_plan.estimated_generation_count = 8
        with self.assertRaisesRegex(ValueError, "预计生图次数"):
            agent_api.validate_routing_decision(decision, payload)

    def test_product_detail_skill_is_published_multi_artifact_workflow(self):
        response = self.client.get("/api/agent/skills")
        self.assertEqual(response.status_code, 200, response.text)
        skill = next(item for item in response.json()["skills"] if item["slug"] == "product-detail-page")
        self.assertEqual(skill["name"], "商品详情页")
        self.assertEqual(skill["status"], "published")
        self.assertEqual(skill["definition_json"]["workflow_type"], "multi_artifact")
        self.assertEqual(skill["definition_json"]["module_limits"], {"min": 4, "max": 12})

    def test_workbench_plan_tolerates_three_sections_but_rejects_two(self):
        decision = {
            "status": "ready",
            "route": "plan_and_generate",
            "reason": "The brief needs a structured design plan before generation.",
            "acknowledgement": "I will turn the brief into an executable visual direction.",
            "clarification": None,
            "plan": {
                "acknowledgement": "The goal, format, and visual direction are clear.",
                "title": "Campaign poster direction",
                "sections": [
                    {
                        "kind": "layout",
                        "title": "Layout",
                        "summary": "Use a clear focal hierarchy and protected text area.",
                    },
                    {
                        "kind": "color",
                        "title": "Color",
                        "summary": "Use a controlled high-contrast campaign palette.",
                    },
                    {
                        "kind": "typography",
                        "title": "Typography",
                        "summary": "Keep the headline legible at social-media sizes.",
                    },
                ],
                "generation_prompt": (
                    "Create a complete campaign poster with a clear focal hierarchy, "
                    "controlled color palette, and highly legible typography."
                ),
            },
            "generation_prompt": "",
        }

        parsed = agent_api.parse_analysis(
            json.dumps(decision),
            agent_api.WorkbenchRoutingDecision,
        )
        self.assertEqual(len(parsed.plan.sections), 3)

        decision["plan"]["sections"] = decision["plan"]["sections"][:2]
        with self.assertRaises(ValueError):
            agent_api.parse_analysis(
                json.dumps(decision),
                agent_api.WorkbenchRoutingDecision,
            )

    def test_workbench_multi_reference_plan_and_review_reject_missing_subject(self):
        references = [
            {"url": f"/assets/input/reference-{index}.png", "name": f"商品{index}"}
            for index in range(1, 6)
        ]
        plan_payload = agent_api.WorkbenchPlanRequest(
            request_id="request-five-subject-plan",
            message="把全部商品做成一张全家福海报",
            reference_images=references,
        )
        incomplete_plan = agent_api.WorkbenchRoutingDecision(
            status="ready",
            route="plan_and_generate",
            reason="信息足够。",
            acknowledgement="制作全家福海报。",
            plan={
                "acknowledgement": "保留全部商品。",
                "title": "商品全家福",
                "sections": [
                    {"kind": "layout", "title": "构图", "summary": "分层陈列。"},
                    {"kind": "color", "title": "色彩", "summary": "品牌蓝银配色。"},
                    {"kind": "fidelity", "title": "还原", "summary": "保留包装。"},
                ],
                "generation_prompt": (
                    "制作全家福，保留参考图1、参考图2、参考图3和参考图4中的商品，"
                    "采用蓝银色摄影棚构图并保持包装清楚可辨。"
                ),
            },
            reference_analysis=[
                {
                    "reference_index": index,
                    "subject_name": f"商品{index}",
                    "relationship": "independent_subject",
                    "must_appear": True,
                    "evidence": "包装外形不同。",
                }
                for index in range(1, 5)
            ],
        )
        with self.assertRaisesRegex(ValueError, "参考图1至参考图5"):
            agent_api.validate_routing_decision(incomplete_plan, plan_payload)

        review_payload = agent_api.WorkbenchReviewRequest(
            request_id="request-five-subject-review",
            message="把全部商品做成一张全家福海报",
            image_url="/assets/output/family.png",
            reference_images=references,
        )
        false_positive_review = agent_api.WorkbenchResultReview(
            title="商品完整",
            summary="声称全部商品均已出现。",
            overall_score=98,
            passed=True,
            highlights=[
                {"title": "构图", "detail": "层次清楚。"},
                {"title": "配色", "detail": "蓝银统一。"},
            ],
            checks=[
                {"label": "商品", "passed": True, "score": 100, "detail": "声称齐全。"},
                {"label": "品牌", "passed": True, "score": 98, "detail": "标识清楚。"},
                {"label": "构图", "passed": True, "score": 98, "detail": "层次清楚。"},
                {"label": "配色", "passed": True, "score": 98, "detail": "配色统一。"},
            ],
            reference_checks=[
                {
                    "reference_index": index,
                    "verdict": "missing" if index == 5 else "present",
                    "evidence": "未找到蓝色大盒。" if index == 5 else f"画面中可定位商品{index}。",
                }
                for index in range(1, 6)
            ],
            conclusion="可以交付。",
            suggestions=[
                {"label": "微调", "instruction": "轻微调整光线。"},
                {"label": "竖版", "instruction": "扩展为竖版。"},
            ],
        )
        with self.assertRaisesRegex(ValueError, "参考图5未确认"):
            agent_api.validate_result_review(false_positive_review, review_payload)

    def test_conversation_surfaces_and_canvas_contexts_are_strictly_isolated(self):
        gpt = self.client.post("/api/conversations", json={
            "title": "GPT 对话",
            "surface": "gpt_chat",
        })
        design = self.client.post("/api/conversations", json={
            "title": "画布 A",
            "surface": "design_agent",
            "context_id": "canvas-a",
        })
        self.assertEqual(gpt.status_code, 200, gpt.text)
        self.assertEqual(design.status_code, 200, design.text)
        gpt_id = gpt.json()["conversation"]["id"]
        design_id = design.json()["conversation"]["id"]

        gpt_list = self.client.get("/api/conversations?surface=gpt_chat")
        design_list = self.client.get(
            "/api/conversations?surface=design_agent&context_id=canvas-a"
        )
        self.assertEqual(
            [item["id"] for item in gpt_list.json()["conversations"]], [gpt_id]
        )
        self.assertEqual(
            [item["id"] for item in design_list.json()["conversations"]], [design_id]
        )

        wrong_surface = self.client.get(f"/api/conversations/{design_id}")
        wrong_canvas = self.client.get(
            f"/api/conversations/{design_id}?surface=design_agent&context_id=canvas-b"
        )
        self.assertEqual(wrong_surface.status_code, 409, wrong_surface.text)
        self.assertEqual(
            wrong_surface.json()["detail"]["code"], "conversation_surface_conflict"
        )
        self.assertEqual(wrong_canvas.status_code, 409, wrong_canvas.text)
        self.assertEqual(
            wrong_canvas.json()["detail"]["code"], "conversation_context_conflict"
        )

    def test_legacy_conversation_referenced_by_smart_canvas_is_classified_as_design(self):
        created = self.client.post("/api/conversations", json={"title": "旧设计记录"})
        self.assertEqual(created.status_code, 200, created.text)
        conversation = created.json()["conversation"]
        user_id = self.client.get("/api/conversations").json()["user_id"]
        conversation.pop("surface", None)
        conversation.pop("context_id", None)
        main.save_conversation(user_id, conversation)

        canvas = {
            "id": "legacy-smart-canvas",
            "kind": "smart",
            "document": {
                "agent_session": {
                    "schema_version": 1,
                    "conversation_id": conversation["id"],
                    "messages": [],
                    "run": None,
                },
            },
        }
        with open(
            Path(main.CANVAS_DIR) / "legacy-smart-canvas.json",
            "w",
            encoding="utf-8",
        ) as handle:
            json.dump(canvas, handle, ensure_ascii=False)

        gpt_ids = {
            item["id"]
            for item in self.client.get(
                "/api/conversations?surface=gpt_chat"
            ).json()["conversations"]
        }
        design_records = self.client.get(
            "/api/conversations?surface=design_agent&context_id=legacy-smart-canvas"
        )
        self.assertNotIn(conversation["id"], gpt_ids)
        self.assertEqual(design_records.status_code, 200, design_records.text)
        self.assertEqual(
            [item["id"] for item in design_records.json()["conversations"]],
            [conversation["id"]],
        )

    def test_legacy_conversation_shared_by_two_canvases_requires_a_new_scoped_session(self):
        created = self.client.post("/api/conversations", json={"title": "共享旧记录"})
        conversation = created.json()["conversation"]
        user_id = self.client.get("/api/conversations").json()["user_id"]
        conversation.pop("surface", None)
        conversation.pop("context_id", None)
        main.save_conversation(user_id, conversation)

        for canvas_id in ("legacy-canvas-a", "legacy-canvas-b"):
            canvas = {
                "id": canvas_id,
                "kind": "smart",
                "document": {
                    "agent_session": {
                        "schema_version": 1,
                        "conversation_id": conversation["id"],
                        "messages": [],
                        "run": None,
                    },
                },
            }
            with open(
                Path(main.CANVAS_DIR) / f"{canvas_id}.json",
                "w",
                encoding="utf-8",
            ) as handle:
                json.dump(canvas, handle, ensure_ascii=False)

        for canvas_id in ("legacy-canvas-a", "legacy-canvas-b"):
            listed = self.client.get(
                f"/api/conversations?surface=design_agent&context_id={canvas_id}"
            )
            self.assertEqual(listed.status_code, 200, listed.text)
            self.assertNotIn(
                conversation["id"],
                [item["id"] for item in listed.json()["conversations"]],
            )
            direct = self.client.get(
                f"/api/conversations/{conversation['id']}"
                f"?surface=design_agent&context_id={canvas_id}"
            )
            self.assertEqual(direct.status_code, 409, direct.text)
            self.assertEqual(
                direct.json()["detail"]["code"], "legacy_conversation_ambiguous"
            )

        gpt_ids = [
            item["id"]
            for item in self.client.get(
                "/api/conversations?surface=gpt_chat"
            ).json()["conversations"]
        ]
        self.assertNotIn(conversation["id"], gpt_ids)

    def test_agent_request_status_rejects_another_canvas_scope(self):
        created = self.client.post("/api/conversations", json={
            "title": "画布 A 请求",
            "surface": "design_agent",
            "context_id": "canvas-a",
        })
        conversation = created.json()["conversation"]
        request_id = "request-status-canvas-a"
        conversation["messages"] = [
            {
                "id": "status-user",
                "role": "user",
                "content": "生成海报",
                "request_id": request_id,
            },
            {
                "id": "status-assistant",
                "role": "assistant",
                "type": "image",
                "content": "生成完成",
                "image_url": "/output/result.png",
                "request_id": request_id,
            },
        ]
        user_id = self.client.get(
            "/api/conversations?surface=design_agent&context_id=canvas-a"
        ).json()["user_id"]
        main.save_conversation(user_id, conversation)

        wrong = self.client.get(
            f"/api/chat/agent/requests/{request_id}"
            "?surface=design_agent&context_id=canvas-b"
        )
        correct = self.client.get(
            f"/api/chat/agent/requests/{request_id}"
            "?surface=design_agent&context_id=canvas-a"
        )
        self.assertEqual(wrong.status_code, 409, wrong.text)
        self.assertEqual(wrong.json()["detail"]["code"], "conversation_context_conflict")
        self.assertEqual(correct.status_code, 200, correct.text)
        self.assertEqual(correct.json()["message"]["id"], "status-assistant")

    def test_chat_request_replay_accepts_pre_v2_fingerprint(self):
        payload = main.ChatRequest(
            conversation_id="",
            request_id="request-pre-v2-fingerprint",
            surface="design_agent",
            context_id="canvas-a",
            session_id="session-a",
            turn_id="turn-a",
            parent_turn_id="turn-parent",
            message="继续优化海报",
            mode="text",
        )
        legacy_data = payload.model_dump(mode="json")
        legacy_data.pop("size_is_explicit", None)  # This optional field did not exist in old requests.
        legacy_data.pop("conversation_id", None)
        legacy_data.pop("request_id", None)
        canonical = json.dumps(
            legacy_data,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        )
        import hashlib
        pre_v2_fingerprint = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        user_id = self.client.get("/api/conversations").json()["user_id"]
        conversation = main.new_conversation(
            user_id, "旧指纹", "design_agent", "canvas-a"
        )
        conversation["messages"] = [
            {
                "id": "fingerprint-user",
                "role": "user",
                "content": payload.message,
                "request_id": payload.request_id,
                "request_fingerprint": pre_v2_fingerprint,
            },
            {
                "id": "fingerprint-assistant",
                "role": "assistant",
                "content": "已完成",
                "request_id": payload.request_id,
            },
        ]
        main.save_conversation(user_id, conversation)

        replay = main.replay_or_reject_chat_request(
            user_id=user_id,
            request_id=payload.request_id,
            fingerprint=main.chat_request_fingerprint(payload),
            legacy_fingerprint=main.chat_request_fingerprint(payload, legacy=True),
            compatibility_fingerprints=main.chat_request_compatibility_fingerprints(payload),
            surface="design_agent",
            context_id="canvas-a",
            conversation_id=conversation["id"],
        )
        self.assertEqual(replay["message"]["id"], "fingerprint-assistant")

    def test_drawing_size_survives_dispatch_context_and_replay(self):
        generator = AsyncMock(return_value=("mock-image", {}))
        provider = {"id": "qa", "image_models": ["mock-image"]}
        with patch.object(main, "generate_ai_image", generator), patch.object(main, "save_ai_image_to_output", AsyncMock(return_value="https://example.invalid/qa.png")), patch.object(main, "get_api_provider", return_value=provider), patch.object(main, "pick_chat_image_provider", return_value=provider):
            for endpoint in ("/api/chat", "/api/chat/agent"):
                payload = {
                    "request_id": f"hd-{endpoint.rsplit('/',1)[-1]}", "surface": "gpt_chat", "mode": "image",
                    "message": "保留图中的 1024x1024 字样和 1:1 字样", "image_provider": "qa", "provider": "qa", "image_model": "mock-image",
                    "size": "2304x4096", "size_is_explicit": True,
                }
                response = self.client.post(endpoint, json=payload)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(generator.call_args.args[1], "2304x4096")
                user_message = next(item for item in response.json()["conversation"]["messages"] if item["role"] == "user")
                self.assertEqual(user_message["request_context"]["size"], "2304x4096")
                self.assertIs(user_message["request_context"]["size_is_explicit"], True)
                if endpoint.endswith("agent"):
                    calls = generator.call_count
                    payload["conversation_id"] = response.json()["conversation"]["id"]
                    replay = self.client.post(endpoint, json=payload)
                    self.assertEqual(replay.status_code, 200, replay.text)
                    self.assertEqual(generator.call_count, calls)

    def test_unavailable_conversation_id_returns_409_instead_of_silent_recreation(self):
        before = main.PLATFORM_STORE.user_balance(self.user_id)["balance"]
        response = self.client.post("/api/chat/agent", json={
            "conversation_id": "belongs-to-another-identity",
            "surface": "design_agent",
            "context_id": "canvas-a",
            "session_id": "session-a",
            "turn_id": "turn-a",
            "request_id": "request-unavailable-conversation",
            "message": "继续优化海报",
            "mode": "text",
        })
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()["detail"]["code"], "conversation_unavailable")
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], before)

    def test_scope_conflict_can_retry_same_request_in_a_new_controlled_session(self):
        gpt = self.client.post("/api/conversations", json={
            "title": "旧身份会话",
            "surface": "gpt_chat",
        }).json()["conversation"]
        request_id = "request-controlled-session-retry"
        payload = {
            "conversation_id": gpt["id"],
            "surface": "design_agent",
            "context_id": "canvas-a",
            "session_id": "session-a",
            "turn_id": "turn-a",
            "request_id": request_id,
            "message": "继续优化当前海报",
            "mode": "text",
        }
        before = main.PLATFORM_STORE.user_balance(self.user_id)["balance"]
        conflict = self.client.post("/api/chat/agent", json=payload)
        async def decide_as_chat(*_args, **_kwargs):
            return {"action": "chat", "prompt": "", "reply": ""}

        async def build_test_reply(*_args, **_kwargs):
            return {
                "id": "controlled-session-reply",
                "role": "assistant",
                "type": "text",
                "content": "已继续优化",
                "created_at": int(time.time() * 1000),
                "model": "test-llm",
                "provider": "test",
            }

        with (
            patch.object(main, "decide_chat_agent_action", side_effect=decide_as_chat),
            patch.object(main, "build_chat_text_reply", side_effect=build_test_reply),
        ):
            retried = self.client.post(
                "/api/chat/agent",
                json={**payload, "conversation_id": ""},
            )

        self.assertEqual(conflict.status_code, 409, conflict.text)
        self.assertEqual(
            conflict.json()["detail"]["code"], "conversation_surface_conflict"
        )
        self.assertEqual(retried.status_code, 200, retried.text)
        self.assertEqual(retried.json()["conversation"]["surface"], "design_agent")
        self.assertEqual(retried.json()["conversation"]["context_id"], "canvas-a")
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user_id)["balance"], before - 1)

    def test_project_isolation(self):
        project = self.client.post("/api/agent/projects", json={"name": "私有项目"}).json()["project"]
        other = TestClient(main.app)
        # Both HTTP clients target the same running application/event loop.
        other.portal = self.client.portal
        second = main.PLATFORM_STORE.create_user("other", "password123")
        main.PLATFORM_STORE.set_user_status(second["id"], "enabled")
        other.post("/api/auth/login", json={"username": "other", "password": "password123"})
        response = other.get(f"/api/agent/projects/{project['id']}")
        other.close()
        self.assertEqual(response.status_code, 404)

    def test_optimistic_lock_cancel_and_skill_lifecycle(self):
        project = self.client.post("/api/agent/projects", json={"name": "状态机"}).json()["project"]
        saved = self.client.put(
            f"/api/agent/projects/{project['id']}/brief",
            json={"version": 0, "payload": {"objective": "状态机测试"}},
        )
        self.assertEqual(saved.status_code, 200)
        conflict = self.client.put(
            f"/api/agent/projects/{project['id']}/brief",
            json={"version": 0, "payload": {"objective": "过期写入"}},
        )
        self.assertEqual(conflict.status_code, 409)

        run = self.client.post("/api/agent/runs", json={"project_id": project["id"]}).json()["run"]
        self.wait_for_status(run["id"], "awaiting_approval")
        cancelled = self.client.post(f"/api/agent/runs/{run['id']}/actions", json={"action": "cancel"})
        self.assertEqual(cancelled.status_code, 200, cancelled.text)
        snapshot = self.client.get(f"/api/agent/runs/{run['id']}").json()
        self.assertEqual(snapshot["run"]["status"], "cancelled")
        self.assertTrue(all(step["status"] == "cancelled" for step in snapshot["steps"]))

        created = self.client.post("/api/agent/skills", json={
            "slug": "campaign-layout", "name": "Campaign Layout", "definition": {"role": "layout"},
        })
        self.assertEqual(created.status_code, 201, created.text)
        skill_id = created.json()["skill"]["id"]
        invalid = self.client.post(f"/api/agent/skills/{skill_id}/actions", json={"action": "publish"})
        self.assertEqual(invalid.status_code, 409)
        for action, expected in (("trial", "trial"), ("review", "review"), ("publish", "published"), ("retire", "retired")):
            response = self.client.post(f"/api/agent/skills/{skill_id}/actions", json={"action": action})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["skill"]["status"], expected)

    def test_quality_gate_stops_after_two_automatic_corrections(self):
        base_llm = agent_api._dependencies.call_llm
        base_image = agent_api._dependencies.generate_image
        generated_count = 0

        async def failing_quality(payload):
            if "Quality Critic" not in str(payload.get("system_prompt") or ""):
                return await base_llm(payload)
            return {"text": json.dumps({
                "hard_issues": ["logo mismatch"],
                "scores": {"brand": 60, "product_fidelity": 62, "clarity": 82},
                "overall_score": 68,
                "summary": "需要人工处理",
            }, ensure_ascii=False)}

        async def counted_image(payload):
            nonlocal generated_count
            generated_count += 1
            return await base_image(payload)

        agent_api.configure_agent_dependencies(call_llm=failing_quality, generate_image=counted_image)
        project = self.client.post("/api/agent/projects", json={"name": "修正上限"}).json()["project"]
        self.client.put(
            f"/api/agent/projects/{project['id']}/brief",
            json={"version": 0, "payload": {"objective": "品牌主视觉"}},
        )
        run_id = self.client.post("/api/agent/runs", json={"project_id": project["id"]}).json()["run"]["id"]
        snapshot = self.wait_for_status(run_id, "awaiting_approval")
        plan_approval = next(item for item in snapshot["approvals"] if item["kind"] == "plan" and item["status"] == "pending")
        self.client.post(
            f"/api/agent/runs/{run_id}/actions",
            json={"action": "approve", "approval_id": plan_approval["id"]},
        )
        snapshot = self.wait_for_status(run_id, "awaiting_approval")
        self.assertEqual(generated_count, 3)
        self.assertEqual(len(snapshot["quality_reports"]), 3)
        self.assertEqual(len(snapshot["assets"]), 3)
        self.assertFalse(snapshot["quality_reports"][-1]["passed"])
        art_step = next(step for step in snapshot["steps"] if step["role"] == "Art Director")
        self.assertEqual(art_step["attempt_count"], 3)

    def test_provider_display_name_resolves_to_configured_id(self):
        original_loader = main.load_api_providers
        main.load_api_providers = lambda: [
            {"id": "runninghub", "name": "RunningHub", "enabled": True, "image_models": []},
            {
                "id": "custom-api",
                "name": "comfly",
                "enabled": True,
                "image_models": ["gpt-image-2"],
                "chat_models": ["gpt-5.5"],
            },
        ]
        try:
            self.assertEqual(main.get_api_provider("comfly")["id"], "custom-api")
            self.assertEqual(main.pick_chat_image_provider("comfly")["id"], "custom-api")
        finally:
            main.load_api_providers = original_loader


if __name__ == "__main__":
    unittest.main()
