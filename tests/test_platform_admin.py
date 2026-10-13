import asyncio
import base64
import io
import json
import tempfile
import threading
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient
from fastapi import HTTPException
import httpx
from PIL import Image

import main
from platform_admin import PlatformStore, PlatformStoreError
from tests.mysql_support import isolated_platform_database


def password_fields(password):
    salt, digest, iterations = PlatformStore.password_record(password)
    return {
        "password_salt": salt,
        "password_hash": digest,
        "password_iterations": iterations,
    }


class RemoteMediaPersistenceTests(unittest.TestCase):
    def test_embedded_image_content_url_is_decoded_without_an_upstream_request(self):
        expected = base64.b64encode(b"image-bytes").decode("ascii")
        wrapper = {"kind": "upstream", "url": f"data:image/png;base64,{expected}"}
        encoded = base64.urlsafe_b64encode(json.dumps(wrapper).encode("utf-8")).decode("ascii").rstrip("=")

        image = main.image_payload_from_content_url(
            f"https://multimodel.example/v1/images/content/{encoded}"
        )

        self.assertEqual(image["type"], "b64")
        self.assertEqual(image["mime_type"], "image/png")
        self.assertEqual(image["value"], expected)

    def test_signed_embedded_image_content_url_ignores_signature(self):
        expected = base64.b64encode(b"signed-image-bytes").decode("ascii")
        wrapper = {"kind": "upstream", "url": f"data:image/png;base64,{expected}"}
        encoded = base64.urlsafe_b64encode(json.dumps(wrapper).encode("utf-8")).decode("ascii").rstrip("=")

        image = main.image_payload_from_content_url(
            f"https://multimodel.example/v1/images/content/{encoded}.0123456789abcdef"
        )

        self.assertEqual(image["type"], "b64")
        self.assertEqual(image["mime_type"], "image/png")
        self.assertEqual(image["value"], expected)

    def test_embedded_image_content_url_is_saved_locally_without_http(self):
        content = b"persisted-image-bytes"
        wrapper = {
            "kind": "upstream",
            "url": f"data:image/png;base64,{base64.b64encode(content).decode('ascii')}",
        }
        encoded = base64.urlsafe_b64encode(json.dumps(wrapper).encode("utf-8")).decode("ascii").rstrip("=")
        remote_url = f"https://multimodel.example/v1/images/content/{encoded}"
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            with (
                patch.object(main, "output_path_for", side_effect=lambda filename, _category: str(root / filename)),
                patch.object(main, "output_url_for", side_effect=lambda filename, _category: f"/assets/output/{filename}"),
                patch.object(main.httpx, "AsyncClient", side_effect=AssertionError("unexpected upstream request")),
            ):
                result = asyncio.run(main.save_ai_image_to_output({"type": "url", "value": remote_url}))

            self.assertTrue(result.startswith("/assets/output/online_"))
            self.assertEqual((root / result.rsplit("/", 1)[-1]).read_bytes(), content)

    def test_signed_embedded_image_content_url_is_saved_locally_without_http(self):
        content = b"signed-persisted-image-bytes"
        wrapper = {
            "kind": "upstream",
            "url": f"data:image/png;base64,{base64.b64encode(content).decode('ascii')}",
        }
        encoded = base64.urlsafe_b64encode(json.dumps(wrapper).encode("utf-8")).decode("ascii").rstrip("=")
        remote_url = f"https://multimodel.example/v1/images/content/{encoded}.abcdef0123456789"
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            with (
                patch.object(main, "output_path_for", side_effect=lambda filename, _category: str(root / filename)),
                patch.object(main, "output_url_for", side_effect=lambda filename, _category: f"/assets/output/{filename}"),
                patch.object(main.httpx, "AsyncClient", side_effect=AssertionError("unexpected upstream request")),
            ):
                result = asyncio.run(main.save_ai_image_to_output({"type": "url", "value": remote_url}))

            self.assertTrue(result.startswith("/assets/output/online_"))
            self.assertEqual((root / result.rsplit("/", 1)[-1]).read_bytes(), content)

    def test_provider_authorization_is_only_sent_to_its_own_host(self):
        provider = {
            "id": "yunqiao",
            "name": "云桥",
            "base_url": "https://multimodel.example/v1",
            "enabled": True,
        }
        with (
            patch.object(main, "get_api_provider_exact", return_value=provider),
            patch.object(main, "api_headers", return_value={"Authorization": "Bearer secret"}),
        ):
            own_headers = main.remote_media_request_headers(
                "https://multimodel.example/v1/images/content/value", "yunqiao", "gpt-image-2"
            )
            foreign_headers = main.remote_media_request_headers(
                "https://cdn.example/image.png", "yunqiao", "gpt-image-2"
            )

        self.assertEqual(own_headers["Authorization"], "Bearer secret")
        self.assertNotIn("Authorization", foreign_headers)


class PlatformStoreTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(isolated_platform_database())
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = PlatformStore(self.root / "users.sqlite3", self.root / "legacy.json")

    def tearDown(self):
        self.temp.cleanup()

    def test_generation_task_claim_is_persistent_and_idempotent(self):
        self.store.initialize()
        first, created = self.store.claim_generation_task(
            "task-1", 7, "canvas-image", "request-1", "fingerprint-1",
            {"prompt": "hello"},
        )
        replay, replay_created = self.store.claim_generation_task(
            "task-2", 7, "canvas-image", "request-1", "fingerprint-1",
            {"prompt": "hello"},
        )
        self.assertTrue(created)
        self.assertFalse(replay_created)
        self.assertEqual(replay["id"], first["id"])
        self.store.update_generation_task("task-1", status="succeeded", result={"images": ["/output/1.png"]})
        reopened = PlatformStore(self.root / "users.sqlite3", self.root / "legacy.json")
        recovered = reopened.generation_task("task-1", 7)
        self.assertEqual(recovered["status"], "succeeded")
        self.assertEqual(recovered["result"]["images"], ["/output/1.png"])

    def test_runtime_does_not_import_legacy_auth_files(self):
        legacy = {
            "session_secret": "legacy-secret",
            "users": [
                {"username": "owner", "role": "admin", **password_fields("password123")},
                {"username": "member", "role": "member", **password_fields("password123")},
            ],
        }
        (self.root / "legacy.json").write_text(json.dumps(legacy), encoding="utf-8")
        self.store.initialize()
        self.store.initialize()
        self.assertEqual(self.store.admin_count(), 0)
        self.assertEqual(self.store.user_count(), 0)

    def test_roles_are_safe_by_default_and_last_super_admin_is_protected(self):
        self.store.initialize()
        owner = self.store.create_admin("owner", "password123")
        member = self.store.create_user("member", "password123")

        self.assertEqual(owner["role"], "super_admin")
        self.assertEqual(member["role"], "user")
        with self.assertRaises(PlatformStoreError) as appoint_super_admin:
            self.store.set_user_role(member["id"], "super_admin")
        self.assertEqual(
            appoint_super_admin.exception.code,
            "super_admin_assignment_forbidden",
        )
        with self.assertRaises(PlatformStoreError) as demote:
            self.store.set_user_role(owner["id"], "admin")
        self.assertEqual(demote.exception.code, "last_super_admin")
        with self.assertRaises(PlatformStoreError) as disable:
            self.store.set_user_status(owner["id"], "disabled", "super_admin")
        self.assertEqual(disable.exception.code, "last_super_admin")

    def test_admin_cannot_mutate_super_admin_and_user_dto_is_whitelisted(self):
        self.store.initialize()
        owner = self.store.create_admin("owner", "password123")
        with self.assertRaises(PlatformStoreError) as status_error:
            self.store.set_user_status(owner["id"], "disabled", "admin")
        self.assertEqual(status_error.exception.code, "insufficient_role")
        with self.assertRaises(PlatformStoreError) as credit_error:
            self.store.adjust_credit(owner["id"], "operator", "add", 1, actor_role="admin")
        self.assertEqual(credit_error.exception.code, "insufficient_role")

        dto = self.store.user_by_id(owner["id"])
        for field in ("password_hash", "password_salt", "password_iterations"):
            self.assertNotIn(field, dto)
        self.assertNotIn("password_hash", self.store.list_users()[0])

    def test_audit_records_metadata_only(self):
        self.store.initialize()
        self.store.create_admin("owner", "password123")
        self.store.audit_event(
            "owner",
            "super_admin",
            "provider.key.replace",
            "provider",
            "demo",
            "api_key",
            ip_address="127.0.0.1",
        )
        with self.store.connect() as connection:
            columns = {
                row["Field"]
                for row in connection.execute("SHOW COLUMNS FROM platform_audit_events").fetchall()
            }
            row = dict(connection.execute("SELECT * FROM platform_audit_events").fetchone())
        self.assertFalse(columns.intersection({"value", "old_value", "new_value", "secret", "api_key"}))
        self.assertEqual(row["field_name"], "api_key")

    def test_reservation_is_atomic_and_failure_refunds(self):
        self.store.initialize()
        self.store.create_admin("owner", "password123")
        user = self.store.create_user("member", "password123")
        self.store.set_user_status(user["id"], "enabled")
        self.store.adjust_credit(user["id"], "owner", "add", 1)
        outcomes = []

        def reserve():
            try:
                outcomes.append(self.store.reserve_usage("member", "image", 1, "parallel-test"))
            except PlatformStoreError as exc:
                outcomes.append(exc.code)

        threads = [threading.Thread(target=reserve) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        event_ids = [value for value in outcomes if value != "insufficient_quota"]
        self.assertEqual(len(event_ids), 1)
        self.assertIn("insufficient_quota", outcomes)
        self.assertEqual(self.store.user_balance(user["id"])["balance"], 0)
        failed = self.store.finish_usage(event_ids[0], False, 0, "failed")
        self.assertEqual(failed["debited_points"], 1)
        self.assertEqual(failed["refunded_points"], 1)
        self.assertEqual(self.store.user_balance(user["id"])["available"], 1)
        with self.store.connect() as connection:
            movements = connection.execute(
                "SELECT action, delta FROM platform_credit_ledger WHERE usage_event_id=? ORDER BY created_at, CASE action WHEN 'usage_debit' THEN 0 ELSE 1 END",
                (event_ids[0],),
            ).fetchall()
        self.assertEqual([(row["action"], row["delta"]) for row in movements], [
            ("usage_debit", -1), ("usage_refund", 1),
        ])

    def test_image_settlement_and_pricing_snapshot(self):
        self.store.initialize()
        self.store.create_admin("owner", "password123")
        user = self.store.create_user("member", "password123")
        self.store.set_user_status(user["id"], "enabled")
        self.store.adjust_credit(user["id"], "owner", "set", 20)
        event = self.store.reserve_usage("member", "image", 4, "batch")
        self.store.set_pricing({"image": 3})
        settled = self.store.finish_usage(event, True, 2)
        self.assertEqual(settled["unit_cost"], 1)
        self.assertEqual(settled["charged_points"], 2)
        self.assertEqual(settled["debited_points"], 4)
        self.assertEqual(settled["refunded_points"], 2)
        self.assertEqual(self.store.user_balance(user["id"])["balance"], 18)
        overview = self.store.overview()
        self.assertEqual(overview["usage"]["image_outputs"], 2)
        self.assertEqual(overview["features"][0]["surface_label"], "图片")
        self.assertEqual(overview["features"][0]["feature_label"], "batch")
        self.assertEqual(overview["features"][0]["points_used"], 2)

    def test_model_pricing_overrides_category_and_keeps_category_fallback(self):
        self.store.initialize()
        self.store.create_admin("owner", "password123")
        user = self.store.create_user("member", "password123")
        self.store.set_user_status(user["id"], "enabled")
        self.store.adjust_credit(user["id"], "owner", "set", 30)
        self.store.set_pricing({"image": 3})
        self.store.set_model_pricing({"gpt-image-2": 7})

        model_event = self.store.reserve_usage("member", "image", 1, "model-price", "GPT-IMAGE-2")
        fallback_event = self.store.reserve_usage("member", "image", 1, "fallback-price", "other-image")

        with self.store.connect() as connection:
            model_row = connection.execute("SELECT unit_cost FROM platform_usage_events WHERE id=?", (model_event,)).fetchone()
            fallback_row = connection.execute("SELECT unit_cost FROM platform_usage_events WHERE id=?", (fallback_event,)).fetchone()
        self.assertEqual(model_row["unit_cost"], 7)
        self.assertEqual(fallback_row["unit_cost"], 3)
        self.assertEqual(self.store.model_pricing(), {"gpt-image-2": 7})

    def test_user_summary_counts_outputs_for_every_category(self):
        self.store.initialize()
        self.store.create_admin("owner", "password123")
        user = self.store.create_user("member", "password123")
        self.store.set_user_status(user["id"], "enabled")
        self.store.adjust_credit(user["id"], "owner", "set", 100)

        expected_outputs = {"image": 2, "video": 3, "chat": 4, "workflow": 5}
        for category, output_units in expected_outputs.items():
            event_id = self.store.reserve_usage("member", category, 1, f"{category}-summary")
            self.store.finish_usage(event_id, True, output_units)

        summary = next(row for row in self.store.list_users() if row["username"] == "member")
        for category, output_units in expected_outputs.items():
            self.assertEqual(summary[f"{category}_tasks"], 1)
            self.assertEqual(summary[f"{category}_outputs"], output_units)

    def test_user_summary_separates_current_and_historical_balance(self):
        self.store.initialize()
        self.store.create_admin("owner", "password123")
        user = self.store.create_user("member", "password123")
        self.store.set_user_status(user["id"], "enabled")
        self.store.adjust_credit(user["id"], "owner", "set", 20)

        event_id = self.store.reserve_usage("member", "image", 4, "balance-summary")
        self.store.finish_usage(event_id, True, 2)

        summary = next(row for row in self.store.list_users() if row["username"] == "member")
        self.assertEqual(summary["available_points"], 18)
        self.assertEqual(summary["historical_balance"], 20)

    def test_usage_reservation_upgrade_is_atomic_and_checks_full_image_cost(self):
        self.store.initialize()
        self.store.create_admin("owner", "password123")
        user = self.store.create_user("member", "password123")
        self.store.set_user_status(user["id"], "enabled")
        self.store.adjust_credit(user["id"], "owner", "set", 5)
        self.store.set_pricing({"chat": 1, "image": 3})
        event_id = self.store.reserve_usage("member", "chat", 1, "agent-route", "router-model")

        with self.assertRaises(PlatformStoreError) as raised:
            self.store.upgrade_usage_reservation(event_id, "image", 2, "image-model")

        self.assertEqual(raised.exception.code, "insufficient_quota")
        unchanged = self.store.usage_details(status="reserved")[0]
        self.assertEqual(unchanged["category"], "chat")
        self.assertEqual(unchanged["reserved_points"], 1)

        self.store.adjust_credit(user["id"], "owner", "add", 1)
        upgraded = self.store.upgrade_usage_reservation(event_id, "image", 2, "image-model")
        self.assertEqual(upgraded["category"], "image")
        self.assertEqual(upgraded["requested_units"], 2)
        self.assertEqual(upgraded["unit_cost"], 3)
        self.assertEqual(upgraded["reserved_points"], 6)
        settled = self.store.finish_usage(event_id, True, 2)
        self.assertEqual(settled["charged_points"], 6)
        self.assertEqual(self.store.user_balance(user["id"])["balance"], 0)

    def test_idempotent_reservation_reuses_the_same_usage_event(self):
        self.store.initialize()
        self.store.create_admin("owner", "password123")
        user = self.store.create_user("member", "password123")
        self.store.set_user_status(user["id"], "enabled")
        self.store.adjust_credit(user["id"], "owner", "set", 10)

        first_id, first_created = self.store.reserve_usage_idempotent(
            "run:step:1:image", "member", "image", 1, "agent-image", "demo-model"
        )
        second_id, second_created = self.store.reserve_usage_idempotent(
            "run:step:1:image", "member", "image", 1, "agent-image", "demo-model"
        )

        self.assertEqual(first_id, second_id)
        self.assertTrue(first_created)
        self.assertFalse(second_created)
        self.assertEqual(self.store.user_balance(user["id"])["reserved"], 1)
        self.assertEqual(
            self.store.usage_by_idempotency_key("run:step:1:image")["external_task_id"],
            "",
        )

    def test_retryable_reservation_replaces_failed_attempt_and_charges_once(self):
        self.store.initialize()
        self.store.create_admin("owner", "password123")
        user = self.store.create_user("member", "password123")
        self.store.set_user_status(user["id"], "enabled")
        self.store.adjust_credit(user["id"], "owner", "set", 10)

        first_id, first_created = self.store.reserve_usage_retryable(
            "workbench:member:request-1", "member", "chat", 1, "workbench-plan", "demo-model"
        )
        self.store.finish_usage(first_id, False, 0, "analysis failed")
        second_id, second_created = self.store.reserve_usage_retryable(
            "workbench:member:request-1", "member", "chat", 1, "workbench-plan", "demo-model"
        )
        settled = self.store.finish_usage(second_id, True, 1)
        replay_id, replay_created = self.store.reserve_usage_retryable(
            "workbench:member:request-1", "member", "chat", 1, "workbench-plan", "demo-model"
        )

        self.assertTrue(first_created)
        self.assertTrue(second_created)
        self.assertNotEqual(first_id, second_id)
        self.assertEqual(replay_id, second_id)
        self.assertFalse(replay_created)
        self.assertEqual(settled["charged_points"], 1)
        self.assertEqual(self.store.user_balance(user["id"])["balance"], 9)
        self.assertEqual(
            self.store.usage_by_idempotency_key("workbench:member:request-1")["external_task_id"],
            "",
        )

    def test_recovered_provider_result_reconciles_a_failed_usage_once(self):
        self.store.initialize()
        self.store.create_admin("owner", "password123")
        user = self.store.create_user("member", "password123")
        self.store.set_user_status(user["id"], "enabled")
        self.store.adjust_credit(user["id"], "owner", "set", 10)
        event_id = self.store.reserve_usage("member", "image", 1, "chat-agent", "demo-model")
        self.store.finish_usage(event_id, False, 0, "response disconnected")

        first = self.store.reconcile_usage_success(event_id, 1)
        second = self.store.reconcile_usage_success(event_id, 1)

        self.assertEqual(first["status"], "succeeded")
        self.assertEqual(second["status"], "succeeded")
        self.assertTrue(first["_settled_now"])
        self.assertFalse(second["_settled_now"])
        self.assertEqual(self.store.user_balance(user["id"])["balance"], 9)

    def test_refunded_retry_creates_a_new_reservation_but_a_late_result_can_still_reconcile(self):
        self.store.initialize()
        self.store.create_admin("owner", "password123")
        user = self.store.create_user("member", "password123")
        self.store.set_user_status(user["id"], "enabled")
        self.store.adjust_credit(user["id"], "owner", "set", 10)

        first_id, _ = self.store.reserve_usage_retryable(
            "workbench:member:request-refunded", "member", "chat", 1, "workbench-plan", "demo-model"
        )
        with self.store.connect(immediate=True) as connection:
            connection.execute(
                "UPDATE platform_usage_events SET status='refunded', completed_at=? WHERE id=?",
                (self.store.now_ms(), first_id),
            )

        second_id, second_created = self.store.reserve_usage_retryable(
            "workbench:member:request-refunded", "member", "chat", 1, "workbench-plan", "demo-model"
        )
        late = self.store.reconcile_usage_success(first_id, 1)

        self.assertTrue(second_created)
        self.assertNotEqual(first_id, second_id)
        self.assertEqual(late["status"], "succeeded")
        self.assertTrue(late["_settled_now"])
        self.assertEqual(self.store.user_balance(user["id"])["balance"], 8)

    def test_analytics_uses_shanghai_boundaries_and_aggregates_usage(self):
        self.store.initialize()
        self.store.create_admin("owner", "password123")
        member = self.store.create_user("member", "password123")
        second = self.store.create_user("second", "password123")
        shanghai = ZoneInfo("Asia/Shanghai")

        def timestamp(year, month, day, hour=0, minute=0):
            return int(datetime(year, month, day, hour, minute, tzinfo=shanghai).timestamp() * 1000)

        from_ms = timestamp(2026, 8, 10)
        to_ms = timestamp(2026, 8, 12)
        rows = [
            ("previous", member["id"], "member", "image", "online-image", "model-a", "succeeded", 1, 1, 0, "", timestamp(2026, 8, 9, 23, 59), timestamp(2026, 8, 9, 23, 59) + 500),
            ("at-start", member["id"], "member", "image", "online-image", "model-a", "succeeded", 3, 3, 0, "", from_ms, from_ms + 1200),
            ("failed", member["id"], "member", "chat", "chat", "model-b", "failed", 0, 0, 0, "<b>Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz</b> " + "request failed " * 30, timestamp(2026, 8, 10, 12), timestamp(2026, 8, 10, 12) + 2500),
            ("refunded", second["id"], "second", "video", "canvas-video", "model-b", "refunded", 0, 0, 0, "429 rate limit api_key=top-secret", timestamp(2026, 8, 11, 8), timestamp(2026, 8, 11, 8) + 800),
            ("reserved", second["id"], "second", "workflow", "workflow-test", "model-c", "reserved", 0, 0, 2, "", timestamp(2026, 8, 11, 9), None),
            ("second-success", second["id"], "second", "chat", "chat", "model-a", "succeeded", 1, 1, 0, "", timestamp(2026, 8, 11, 10), timestamp(2026, 8, 11, 10) + 1000),
            ("at-end", member["id"], "member", "image", "online-image", "model-a", "succeeded", 9, 9, 0, "", to_ms, to_ms + 100),
        ]
        with self.store.connect(immediate=True) as connection:
            connection.executemany(
                """INSERT INTO platform_usage_events (
                    id, user_id, username, category, operation, model, status,
                    output_units, charged_points, reserved_points, error,
                    created_at, completed_at, task_count, requested_units, unit_cost
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1)""",
                rows,
            )

        analytics = self.store.analytics(from_ms, to_ms)

        self.assertEqual(analytics["range"]["timezone"], "Asia/Shanghai")
        self.assertEqual(analytics["range"]["from_iso"], "2026-08-10T00:00:00+08:00")
        self.assertEqual(analytics["previous_range"]["from_iso"], "2026-08-08T00:00:00+08:00")
        self.assertEqual(analytics["previous_range"]["to_iso_exclusive"], "2026-08-10T00:00:00+08:00")
        self.assertEqual(
            analytics["summary"],
            {
                "active_users": 2,
                "total_tasks": 5,
                "succeeded_tasks": 2,
                "failed_tasks": 1,
                "refunded_tasks": 1,
                "processing_tasks": 1,
                "terminal_tasks": 4,
                "output_units": 4,
                "charged_points": 4,
                "reserved_points": 2,
                "success_rate": 50.0,
            },
        )
        self.assertEqual(analytics["comparison"]["succeeded_tasks"]["previous"], 1)
        self.assertEqual(analytics["comparison"]["succeeded_tasks"]["delta"], 1)
        self.assertEqual(analytics["comparison"]["output_units"]["change_percent"], 300.0)
        self.assertEqual([row["date"] for row in analytics["series"]], ["2026-08-10", "2026-08-11"])
        self.assertEqual(analytics["series"][0]["output_units"], 3)
        self.assertEqual(analytics["series"][1]["reserved_points"], 2)

        feature = next(row for row in analytics["by_feature"] if row["operation"] == "online-image")
        self.assertEqual((feature["tasks"], feature["output_units"], feature["charged_points"]), (1, 3, 3))
        model = next(row for row in analytics["by_model"] if row["model"] == "model-a")
        self.assertEqual((model["calls"], model["succeeded"], model["output_units"]), (2, 2, 4))
        self.assertEqual(analytics["top_users"][0]["username"], "member")
        self.assertEqual(analytics["top_users"][0]["charged_points"], 3)

        self.assertEqual(analytics["failures"]["total"], 2)
        failures = {row["key"]: row for row in analytics["failures"]["categories"]}
        self.assertEqual(failures["auth_config"]["count"], 1)
        self.assertEqual(failures["rate_limit"]["count"], 1)
        auth_sample = failures["auth_config"]["samples"][0]
        self.assertIn("[REDACTED]", auth_sample)
        self.assertNotIn("abcdefghijklmnopqrstuvwxyz", auth_sample)
        self.assertNotIn("<b>", auth_sample)
        self.assertLessEqual(len(auth_sample), 180)
        self.assertTrue(auth_sample.endswith("…"))


class PlatformApiTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(isolated_platform_database())
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.root = root
        self.original_store = main.PLATFORM_STORE
        main.PLATFORM_STORE = PlatformStore(root / "users.sqlite3", root / "legacy.json")
        main.PLATFORM_STORE.initialize()
        self.admin_client = TestClient(main.app)
        self.user_client = TestClient(main.app)

    def tearDown(self):
        self.admin_client.close()
        self.user_client.close()
        main.PLATFORM_STORE = self.original_store
        self.temp.cleanup()

    def test_registration_approval_credit_and_immediate_disable(self):
        setup = self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        self.assertEqual(setup.status_code, 200)
        registered = self.user_client.post("/api/auth/register", json={"username": "member", "password": "password123"})
        self.assertEqual(registered.status_code, 202)
        self.assertEqual(registered.json()["status"], "pending")
        pending_login = self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})
        self.assertEqual(pending_login.status_code, 403)

        users = self.admin_client.get("/api/admin/users").json()["users"]
        user_id = users[0]["id"]
        self.assertEqual(self.admin_client.patch(f"/api/admin/users/{user_id}", json={"status": "enabled"}).status_code, 200)
        self.assertEqual(self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"}).status_code, 200)
        with patch.object(main, "build_online_image_result", new=AsyncMock(return_value={"images": ["one"]})) as upstream:
            insufficient = self.user_client.post("/api/online-image", json={"prompt": "test", "n": 1})
        self.assertEqual(insufficient.status_code, 402)
        self.assertEqual(insufficient.json()["code"], "insufficient_quota")
        upstream.assert_not_awaited()
        self.assertEqual(self.admin_client.post(f"/api/admin/users/{user_id}/credits", json={"mode": "add", "amount": 5}).status_code, 200)
        auth_status = self.user_client.get("/api/auth/status").json()
        self.assertEqual(auth_status["available_points"], 5)
        self.assertEqual(auth_status["pricing"]["image"], 1)

        self.assertEqual(self.admin_client.patch(f"/api/admin/users/{user_id}", json={"status": "disabled"}).status_code, 200)
        blocked = self.user_client.get("/api/models")
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.json()["code"], "account_disabled")

    def test_user_cookie_cannot_access_admin_api(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})
        response = self.user_client.get("/api/admin/users")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "insufficient_role")

    def test_admin_pricing_catalog_uses_saved_provider_models(self):
        self.admin_client.post(
            "/api/admin/auth/setup",
            json={"username": "owner", "password": "password123"},
        )
        provider = {
            "id": "pricing-provider",
            "name": "已拉取平台",
            "image_models": ["image-demo"],
            "chat_models": ["chat-demo"],
            "video_models": ["video-demo"],
            "model_names": {"image-demo": "图片演示模型"},
        }
        with patch.object(main, "load_api_providers", return_value=[provider]):
            catalog = self.admin_client.get("/api/admin/pricing")
            saved = self.admin_client.put(
                "/api/admin/pricing",
                json={
                    "pricing": {"workflow": 2},
                    "model_pricing": {"image-demo": 5, "chat-demo": 4, "video-demo": 9},
                },
                headers={"X-Current-Password": "password123"},
            )

        self.assertEqual(catalog.status_code, 200)
        models = {item["model"]: item for item in catalog.json()["models"]}
        self.assertEqual(set(models), {"image-demo", "chat-demo", "video-demo"})
        self.assertEqual(models["image-demo"]["name"], "图片演示模型")
        self.assertEqual(models["image-demo"]["providers"], ["已拉取平台"])
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["model_pricing"]["image-demo"], 5)
        self.assertEqual(saved.json()["pricing"]["workflow"], 2)

    def test_admin_login_and_logout_preserve_a_different_frontend_user_session(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        browser = TestClient(main.app)
        self.addCleanup(browser.close)

        self.assertEqual(
            browser.post("/api/auth/login", json={"username": "member", "password": "password123"}).status_code,
            200,
        )
        self.assertEqual(browser.get("/api/auth/status").json()["username"], "member")

        admin_login = browser.post(
            "/api/admin/auth/login",
            json={"username": "owner", "password": "password123"},
        )
        self.assertEqual(admin_login.status_code, 200)
        self.assertEqual(browser.get("/api/admin/users").status_code, 200)
        self.assertEqual(browser.get("/api/auth/status").json()["username"], "member")

        self.assertEqual(browser.post("/api/admin/auth/logout").status_code, 200)
        self.assertEqual(browser.get("/api/auth/status").json()["username"], "member")
        self.assertEqual(browser.get("/api/admin/users").status_code, 403)

    def test_admin_only_login_and_logout_still_manage_the_frontend_session(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        browser = TestClient(main.app)
        self.addCleanup(browser.close)

        self.assertEqual(
            browser.post(
                "/api/admin/auth/login",
                json={"username": "owner", "password": "password123"},
            ).status_code,
            200,
        )
        self.assertEqual(browser.get("/api/auth/status").json()["username"], "owner")

        self.assertEqual(browser.post("/api/admin/auth/logout").status_code, 200)
        self.assertFalse(browser.get("/api/auth/status").json()["authenticated"])

    def test_analytics_allows_admin_and_rejects_regular_user(self):
        self.admin_client.post(
            "/api/admin/auth/setup",
            json={"username": "owner", "password": "password123"},
        )
        operator = main.PLATFORM_STORE.create_user("operator", "password123")
        member = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(operator["id"], "enabled")
        main.PLATFORM_STORE.set_user_status(member["id"], "enabled")
        promoted = self.admin_client.patch(
            f"/api/admin/users/{operator['id']}/role",
            json={"role": "admin", "current_password": "password123"},
        )
        self.assertEqual(promoted.status_code, 200)

        operator_client = TestClient(main.app)
        member_client = TestClient(main.app)
        self.addCleanup(operator_client.close)
        self.addCleanup(member_client.close)
        operator_client.post(
            "/api/auth/login",
            json={"username": "operator", "password": "password123"},
        )
        member_client.post(
            "/api/auth/login",
            json={"username": "member", "password": "password123"},
        )

        allowed = operator_client.get("/api/admin/analytics")
        denied = member_client.get("/api/admin/analytics")

        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.json()["range"]["timezone"], "Asia/Shanghai")
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.json()["code"], "insufficient_role")

    def test_role_permissions_and_settings_visibility_are_enforced_server_side(self):
        self.admin_client.post(
            "/api/admin/auth/setup",
            json={"username": "owner", "password": "password123"},
        )
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        self.user_client.post(
            "/api/auth/login",
            json={"username": "member", "password": "password123"},
        )

        status = self.user_client.get("/api/auth/status")
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.json()["role"], "user")
        self.assertEqual(status.json()["permissions"], ["use_products"])
        for path in (
            "/api/providers",
            "/api/config/token",
            "/api/comfyui/instances",
            "/api/workflows",
            "/static/api-settings.html",
            "/static/comfyui-settings.html",
        ):
            response = self.user_client.get(path)
            self.assertEqual(response.status_code, 403, path)
            self.assertEqual(response.json()["code"], "insufficient_role", path)

        provider = {
            "id": "demo",
            "name": "Demo",
            "base_url": "https://1.1.1.1",
            "protocol": "openai",
            "enabled": True,
            "image_models": ["image-demo"],
            "chat_models": ["chat-demo"],
            "video_models": [],
        }
        with (
            patch.object(main, "load_api_providers", return_value=[provider]),
            patch.object(main, "provider_env_key_value", return_value="secret-value"),
        ):
            safe = self.user_client.get("/api/providers/available")
            managed = self.admin_client.get("/api/providers")
        self.assertEqual(safe.status_code, 200)
        safe_text = safe.text
        self.assertNotIn("base_url", safe_text)
        self.assertNotIn("key_preview", safe_text)
        self.assertNotIn("key_env", safe_text)
        self.assertNotIn("secret-value", safe_text)
        self.assertEqual(managed.status_code, 200)
        self.assertNotIn("secret-value", managed.text)
        self.assertIn("key_preview", managed.text)
        self.assertEqual(self.user_client.get("/api/workflow-catalog").status_code, 200)

    def test_unified_admin_session_and_role_downgrade_take_effect_immediately(self):
        self.admin_client.post(
            "/api/admin/auth/setup",
            json={"username": "owner", "password": "password123"},
        )
        operator = main.PLATFORM_STORE.create_user("operator", "password123")
        main.PLATFORM_STORE.set_user_status(operator["id"], "enabled")
        promoted = self.admin_client.patch(
            f"/api/admin/users/{operator['id']}/role",
            json={"role": "admin", "current_password": "password123"},
        )
        self.assertEqual(promoted.status_code, 200)
        self.user_client.post(
            "/api/auth/login",
            json={"username": "operator", "password": "password123"},
        )
        self.assertEqual(self.user_client.get("/api/admin/users").status_code, 200)
        self.assertEqual(self.user_client.get("/api/admin/pricing").status_code, 403)

        demoted = self.admin_client.patch(
            f"/api/admin/users/{operator['id']}/role",
            json={"role": "user", "current_password": "password123"},
        )
        self.assertEqual(demoted.status_code, 200)
        denied = self.user_client.get("/api/providers")
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(denied.json()["code"], "insufficient_role")

    def test_sensitive_role_and_provider_changes_require_current_password(self):
        self.admin_client.post(
            "/api/admin/auth/setup",
            json={"username": "owner", "password": "password123"},
        )
        member = main.PLATFORM_STORE.create_user("member", "password123")
        missing_password = self.admin_client.patch(
            f"/api/admin/users/{member['id']}/role",
            json={"role": "admin", "current_password": ""},
        )
        self.assertEqual(missing_password.status_code, 401)
        forbidden_super_admin = self.admin_client.patch(
            f"/api/admin/users/{member['id']}/role",
            json={"role": "super_admin", "current_password": "password123"},
        )
        self.assertEqual(forbidden_super_admin.status_code, 403)
        self.assertEqual(
            forbidden_super_admin.json()["code"],
            "super_admin_assignment_forbidden",
        )

        provider = {
            "id": "demo",
            "name": "Demo",
            "base_url": "https://1.1.1.1",
            "protocol": "openai",
            "enabled": True,
            "image_models": [],
            "chat_models": [],
            "video_models": [],
        }
        with patch.object(main, "load_api_providers", return_value=[provider]):
            provider_write = self.admin_client.put("/api/providers", json=[provider])
        self.assertEqual(provider_write.status_code, 401)

    def test_provider_target_binding_and_network_guards(self):
        for url in (
            "http://127.0.0.1:8080",
            "http://169.254.169.254/latest/meta-data",
            "http://10.0.0.1",
            "http://[::1]",
        ):
            with self.assertRaises(PlatformStoreError, msg=url) as raised:
                main.validate_external_provider_url(url)
            self.assertEqual(raised.exception.code, "unsafe_provider_url")

        fake_ip_dns = [(2, 1, 6, "", ("198.18.0.240", 443))]
        with patch.object(main.socket, "getaddrinfo", return_value=fake_ip_dns):
            self.assertEqual(
                main.validate_external_provider_url("https://ai.comfly.org"),
                "https://ai.comfly.org",
            )
            with self.assertRaises(PlatformStoreError):
                main.validate_external_provider_url("http://ai.comfly.org")
        with self.assertRaises(PlatformStoreError):
            main.validate_external_provider_url("https://198.18.0.240")

        mixed_dns = [
            (2, 1, 6, "", ("198.18.0.240", 443)),
            (2, 1, 6, "", ("10.0.0.8", 443)),
        ]
        with patch.object(main.socket, "getaddrinfo", return_value=mixed_dns):
            with self.assertRaises(PlatformStoreError):
                main.validate_external_provider_url("https://mixed.example")

        payload = main.TestConnectionPayload(
            provider_id="demo",
            base_url="https://evil.example",
            protocol="openai",
        )
        provider = {
            "id": "demo",
            "base_url": "https://1.1.1.1",
            "protocol": "openai",
        }
        with (
            patch.object(main, "get_api_provider_exact", return_value=provider),
            patch.object(main, "api_key_from_payload", return_value="saved-secret"),
        ):
            base_url, key, protocol = main.provider_test_target(payload)
        self.assertEqual(base_url, "https://1.1.1.1")
        self.assertEqual(key, "saved-secret")
        self.assertEqual(protocol, "openai")

        custom = main.TestConnectionPayload(
            base_url="https://1.1.1.1",
            protocol="openai",
        )
        with self.assertRaises(PlatformStoreError) as temporary_key:
            main.provider_test_target(custom)
        self.assertEqual(temporary_key.exception.code, "temporary_key_required")

    def test_redirect_targets_and_comfy_credentials_are_redacted(self):
        class RedirectClient:
            def __init__(self):
                self.calls = 0

            async def get(self, url, **kwargs):
                self.calls += 1
                return httpx.Response(
                    302,
                    headers={"location": "http://127.0.0.1/internal"},
                    request=httpx.Request("GET", url),
                )

        client = RedirectClient()
        with self.assertRaises(PlatformStoreError) as redirect_error:
            asyncio.run(main.safe_external_get(client, "https://1.1.1.1/start"))
        self.assertEqual(redirect_error.exception.code, "unsafe_provider_url")
        self.assertEqual(client.calls, 1)

        instance = main.public_comfy_instance(
            "https://user:very-secret@example.com:8188",
            0,
        )
        self.assertEqual(instance["display_address"], "https://example.com:8188")
        self.assertTrue(instance["has_credentials"])
        self.assertNotIn("user", json.dumps(instance))
        self.assertNotIn("very-secret", json.dumps(instance))

    def test_admin_account_accepts_email_username(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        updated = self.admin_client.put(
            "/api/admin/auth/account",
            json={"username": "admin@linghui.ai", "current_password": "password123", "password": "Admin@2026!"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["username"], "admin@linghui.ai")
        self.assertEqual(main.PLATFORM_STORE.authenticate_admin("admin@linghui.ai", "Admin@2026!")["username"], "admin@linghui.ai")

    def test_image_endpoint_charges_actual_outputs_and_refunds_failure(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})

        with patch.object(main, "build_online_image_result", new=AsyncMock(return_value={"images": ["one", "two"]})):
            result = self.user_client.post("/api/online-image", json={"prompt": "test", "n": 3})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(main.PLATFORM_STORE.user_balance(user["id"])["balance"], 8)

        with patch.object(main, "build_online_image_result", new=AsyncMock(side_effect=HTTPException(status_code=502, detail="upstream failed"))):
            failed = self.user_client.post("/api/online-image", json={"prompt": "test", "n": 2})
        self.assertEqual(failed.status_code, 502)
        self.assertEqual(failed.headers.get("x-refunded-points"), "2")
        self.assertEqual(main.PLATFORM_STORE.user_balance(user["id"])["balance"], 8)
        overview = main.PLATFORM_STORE.overview()
        self.assertEqual(overview["usage"]["image_outputs"], 2)
        self.assertEqual(overview["usage"]["failed_tasks"], 1)
        self.assertEqual(self.user_client.get("/api/admin/usage").status_code, 403)
        users_csv = self.admin_client.get("/api/admin/export/users.csv")
        usage_csv = self.admin_client.get("/api/admin/export/usage.csv")
        usage_details = self.admin_client.get("/api/admin/usage")
        self.assertEqual(users_csv.status_code, 200)
        self.assertEqual(usage_csv.status_code, 200)
        self.assertEqual(usage_details.status_code, 200)
        self.assertTrue(users_csv.content.startswith(b"\xef\xbb\xbf"))
        self.assertTrue(usage_csv.content.startswith(b"\xef\xbb\xbf"))
        users_csv_text = users_csv.content.decode("utf-8-sig")
        self.assertIn("member", users_csv_text)
        self.assertIn("历史返还", users_csv_text)
        self.assertIn("返还积分", usage_csv.content.decode("utf-8-sig"))
        failed_event = next(row for row in usage_details.json()["events"] if row["status"] == "failed")
        self.assertEqual(failed_event["debited_points"], 2)
        self.assertEqual(failed_event["refunded_points"], 2)
        self.assertIn("视频产出", users_csv_text)
        self.assertIn("聊天产出", users_csv_text)
        self.assertIn("工作流产出", users_csv_text)
        usage_csv_text = usage_csv.content.decode("utf-8-sig")
        self.assertIn("使用入口", usage_csv_text)
        self.assertIn("具体功能", usage_csv_text)
        self.assertIn("在线生图", usage_csv_text)
        self.assertIn("图片生成", usage_csv_text)
        online_image_event = next(
            event
            for event in usage_details.json()["events"]
            if event["operation"] == "online-image" and event["status"] == "succeeded"
        )
        self.assertEqual(online_image_event["surface_label"], "在线生图")
        self.assertEqual(online_image_event["feature_label"], "图片生成")
        self.assertEqual(online_image_event["charged_points"], 2)

    def test_chat_agent_image_mode_uses_image_pricing(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})

        provider = {"id": "test-provider", "image_models": ["test-image-model"]}
        with (
            patch.object(main, "pick_chat_image_provider", return_value=provider),
            patch.object(main, "generate_ai_image", new=AsyncMock(return_value=(b"image", {}))) as generate_mock,
            patch.object(main, "save_ai_image_to_output", new=AsyncMock(return_value="/assets/output/test.png")),
            patch.object(main, "save_conversation"),
        ):
            result = self.user_client.post(
                "/api/chat/agent",
                json={
                    "message": "把产品移动到画面右侧",
                    "mode": "image",
                    "image_provider": "test-provider",
                    "image_model": "test-image-model",
                    "agent_plan": {
                        "generation_prompt": "根据真实方案，把产品移动到右侧并保留左侧标题区。",
                    },
                    "reference_images": [{"url": "/assets/source.png", "name": "源图", "role": "reference"}],
                },
            )

        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["message"]["agent_action"], "edit_image")
        self.assertEqual(generate_mock.await_args.args[0], "根据真实方案，把产品移动到右侧并保留左侧标题区。")
        self.assertEqual(result.json()["message"]["design_plan"]["generation_prompt"], "根据真实方案，把产品移动到右侧并保留左侧标题区。")
        self.assertEqual(main.PLATFORM_STORE.user_balance(user["id"])["balance"], 9)
        self.assertEqual(main.PLATFORM_STORE.overview()["usage"]["image_outputs"], 1)

    def test_explicit_image_count_generates_outputs_concurrently(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})
        provider = {"id": "test-provider", "image_models": ["test-image-model"]}
        original_conversation_dir = main.CONVERSATION_DIR
        main.CONVERSATION_DIR = str(self.root / "conversations-parallel")
        active = 0
        max_active = 0

        async def concurrent_image(*_args, **kwargs):
            nonlocal active, max_active
            active += 1
            max_active = max(max_active, active)
            try:
                await asyncio.sleep(0.03)
                operation_id = str(kwargs.get("request_id") or "image")
                return operation_id.encode(), {"task_id": f"task-{operation_id}"}
            finally:
                active -= 1

        async def save_image(image_data, prefix="", **_kwargs):
            return f"/assets/output/{prefix}{image_data.decode().replace(':', '-')}.png"

        try:
            with (
                patch.object(main, "pick_chat_image_provider", return_value=provider),
                patch.object(main, "generate_ai_image", new=AsyncMock(side_effect=concurrent_image)) as generate_mock,
                patch.object(main, "save_ai_image_to_output", new=AsyncMock(side_effect=save_image)),
            ):
                response = self.user_client.post("/api/chat/agent", json={
                    "request_id": "parallel-image-request",
                    "message": "生成一组产品图片",
                    "mode": "image",
                    "image_count": 3,
                    "image_provider": "test-provider",
                    "image_model": "test-image-model",
                })

            self.assertEqual(response.status_code, 200)
            self.assertEqual(generate_mock.await_count, 3)
            self.assertEqual(max_active, 3)
            self.assertEqual(response.json()["message"]["image_count"], 3)
            self.assertEqual(len(response.json()["message"]["image_urls"]), 3)
            request_message = next(
                message for message in response.json()["conversation"]["messages"]
                if message.get("role") == "user" and message.get("request_id") == "parallel-image-request"
            )
            self.assertEqual(request_message["request_context"]["request_mode"], "image")
            self.assertEqual(main.PLATFORM_STORE.user_balance(user["id"])["balance"], 7)
        finally:
            main.CONVERSATION_DIR = original_conversation_dir

    def test_prompt_number_does_not_override_default_image_count(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})
        provider = {"id": "test-provider", "image_models": ["test-image-model"]}
        original_conversation_dir = main.CONVERSATION_DIR
        main.CONVERSATION_DIR = str(self.root / "conversations-explicit-count")
        try:
            with (
                patch.object(main, "pick_chat_image_provider", return_value=provider),
                patch.object(main, "generate_ai_image", new=AsyncMock(return_value=(b"image", {}))) as generate_mock,
                patch.object(main, "save_ai_image_to_output", new=AsyncMock(return_value="/assets/output/test.png")),
            ):
                response = self.user_client.post("/api/chat/agent", json={
                    "request_id": "default-image-count-request",
                    "message": "请一次性生成3张图片",
                    "mode": "image",
                    "image_provider": "test-provider",
                    "image_model": "test-image-model",
                })

            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(generate_mock.await_count, 1)
            self.assertEqual(response.json()["message"]["image_count"], 1)
            self.assertEqual(main.PLATFORM_STORE.user_balance(user["id"])["balance"], 9)
        finally:
            main.CONVERSATION_DIR = original_conversation_dir

    def test_paid_post_is_never_retried_after_ambiguous_disconnect(self):
        request = httpx.Request("POST", "https://example.invalid/v1/images/generations")
        client = AsyncMock(side_effect=httpx.RemoteProtocolError("response disconnected", request=request))
        fake_client = type("Client", (), {"request": client})()

        with self.assertRaises(httpx.RemoteProtocolError):
            asyncio.run(main.httpx_request_with_transient_retries(
                fake_client,
                "POST",
                str(request.url),
                attempts=3,
                retry_delay=0,
            ))

        self.assertEqual(client.await_count, 1)

    def test_safe_get_keeps_transient_retries(self):
        request = httpx.Request("GET", "https://example.invalid/v1/tasks/task-1")
        client = AsyncMock(side_effect=httpx.RemoteProtocolError("response disconnected", request=request))
        fake_client = type("Client", (), {"request": client})()

        with self.assertRaises(httpx.RemoteProtocolError):
            asyncio.run(main.httpx_request_with_transient_retries(
                fake_client,
                "GET",
                str(request.url),
                attempts=3,
                retry_delay=0,
            ))

        self.assertEqual(client.await_count, 3)

    def test_responses_ambiguous_disconnect_does_not_fallback_to_second_post(self):
        request = httpx.Request("POST", "https://example.invalid/v1/responses")

        class FakeClient:
            async def post(self, *args, **kwargs):
                raise httpx.RemoteProtocolError("response disconnected", request=request)

        with patch.object(main, "post_openai_responses_stream", new=AsyncMock()) as stream_mock:
            with self.assertRaises(httpx.RemoteProtocolError):
                asyncio.run(main.post_openai_responses(
                    FakeClient(),
                    str(request.url),
                    {"Authorization": "Bearer secret"},
                    {"model": "test-model", "input": "test"},
                ))

        stream_mock.assert_not_awaited()

    def test_gpt_image_request_asks_for_url_and_sends_operation_id(self):
        calls = []

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return False

            async def request(self, method, url, **kwargs):
                calls.append((method, url, kwargs))
                return httpx.Response(
                    200,
                    json={"data": [{"url": "https://cdn.example.invalid/result.png"}]},
                    request=httpx.Request(method, url),
                )

        provider = {
            "id": "test-provider",
            "name": "Test Provider",
            "base_url": "https://example.invalid/v1",
            "protocol": "openai",
            "image_request_mode": "openai",
            "image_models": ["gpt-image-2"],
        }
        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "provider_env_key_value", return_value="secret"),
            patch.object(main.httpx, "AsyncClient", FakeClient),
        ):
            image, _raw = asyncio.run(main.generate_ai_image(
                "端午礼盒海报",
                "1440x1440",
                "auto",
                "gpt-image-2",
                provider_id="test-provider",
                request_id="request-1:image:1",
            ))

        self.assertEqual(image["value"], "https://cdn.example.invalid/result.png")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][2]["json"]["response_format"], "url")
        self.assertEqual(calls[0][2]["json"]["n"], 1)
        self.assertEqual(calls[0][2]["headers"]["X-Request-ID"], "request-1:image:1")

    def test_comfly_image_request_submits_async_once_and_polls_task(self):
        calls = []
        task_polls = 0

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return False

            async def request(self, method, url, **kwargs):
                nonlocal task_polls
                calls.append((method, url, kwargs))
                request = httpx.Request(method, url)
                if method == "POST":
                    return httpx.Response(200, json={"task_id": "task-comfly-1"}, request=request)
                task_polls += 1
                if task_polls == 1:
                    return httpx.Response(200, json={"code": "success", "data": {"status": "IN_PROGRESS"}}, request=request)
                return httpx.Response(
                    200,
                    json={
                        "code": "success",
                        "data": {
                            "status": "SUCCESS",
                            "data": {"data": [{"url": "https://cdn.example.invalid/async-result.png"}]},
                        },
                    },
                    request=request,
                )

        provider = {
            "id": "custom-api",
            "name": "comfly",
            "base_url": "https://ai.comfly.org",
            "protocol": "openai",
            "image_request_mode": "openai",
            "image_models": ["gpt-image-2"],
        }
        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "provider_env_key_value", return_value="secret"),
            patch.object(main.httpx, "AsyncClient", FakeClient),
            patch.object(main.asyncio, "sleep", new=AsyncMock()),
            patch.object(main.PLATFORM_STORE, "set_usage_task_id") as set_usage_task_id,
        ):
            image, raw = asyncio.run(main.generate_ai_image(
                "端午礼盒海报",
                "1440x1440",
                "auto",
                "gpt-image-2",
                provider_id="custom-api",
                request_id="request-async-1",
                usage_event_id="usage-event-1",
            ))

        self.assertEqual(image["value"], "https://cdn.example.invalid/async-result.png")
        self.assertEqual(raw["data"]["status"], "SUCCESS")
        post_calls = [call for call in calls if call[0] == "POST"]
        get_calls = [call for call in calls if call[0] == "GET"]
        self.assertEqual(len(post_calls), 1)
        self.assertEqual(post_calls[0][1], "https://ai.comfly.org/v1/images/generations?async=true")
        self.assertEqual(post_calls[0][2]["headers"]["X-Request-ID"], "request-async-1")
        self.assertEqual(len(get_calls), 2)
        self.assertTrue(all(call[1] == "https://ai.comfly.org/v1/images/tasks/task-comfly-1" for call in get_calls))
        set_usage_task_id.assert_called_once_with("usage-event-1", "task-comfly-1")

    def test_comfly_poll_error_keeps_upstream_task_id(self):
        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return False

            async def request(self, method, url, **kwargs):
                request = httpx.Request(method, url)
                if method == "POST":
                    return httpx.Response(200, json={"task_id": "task-comfly-recoverable"}, request=request)
                raise httpx.RemoteProtocolError("poll disconnected", request=request)

        provider = {
            "id": "custom-api",
            "name": "comfly",
            "base_url": "https://ai.comfly.org",
            "protocol": "openai",
            "image_request_mode": "openai",
            "image_models": ["gpt-image-2"],
        }
        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "provider_env_key_value", return_value="secret"),
            patch.object(main.httpx, "AsyncClient", FakeClient),
            patch.object(main.asyncio, "sleep", new=AsyncMock()),
        ):
            with self.assertRaises(httpx.RemoteProtocolError) as raised:
                asyncio.run(main.generate_ai_image(
                    "端午礼盒海报",
                    "1440x1440",
                    "auto",
                    "gpt-image-2",
                    provider_id="custom-api",
                    request_id="request-poll-error",
                ))

        self.assertEqual(getattr(raised.exception, "upstream_task_id", ""), "task-comfly-recoverable")

    def test_comfly_terminal_failure_keeps_upstream_task_id(self):
        calls = []

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return False

            async def request(self, method, url, **kwargs):
                calls.append((method, url, kwargs))
                request = httpx.Request(method, url)
                if method == "POST":
                    return httpx.Response(200, json={"task_id": "task-comfly-terminal"}, request=request)
                return httpx.Response(200, json={
                    "code": "success",
                    "data": {
                        "status": "FAILURE",
                        "fail_reason": "Upstream stream was interrupted before completion. Please retry later.",
                        "start_time": 0,
                        "cost": 0,
                    },
                }, request=request)

        provider = {
            "id": "custom-api",
            "name": "comfly",
            "base_url": "https://ai.comfly.org",
            "protocol": "openai",
            "image_request_mode": "openai",
            "image_models": ["gpt-image-2"],
        }
        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "provider_env_key_value", return_value="secret"),
            patch.object(main.httpx, "AsyncClient", FakeClient),
        ):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(main.generate_ai_image(
                    "端午礼盒海报",
                    "2048x2048",
                    "auto",
                    "gpt-image-2",
                    provider_id="custom-api",
                    request_id="request-terminal",
                ))

        self.assertEqual(len([call for call in calls if call[0] == "POST"]), 1)
        self.assertEqual(getattr(raised.exception, "upstream_task_id", ""), "task-comfly-terminal")

    def test_canvas_terminal_failure_without_local_metadata_remains_recoverable(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})
        payload = main.OnlineImageRequest(
            prompt="端午礼盒海报",
            provider_id="custom-api",
            model="gpt-image-2",
            size="2048x2048",
            n=1,
            request_id="request-canvas-terminal",
        )
        usage_key = "generation:member:canvas-terminal"
        usage_event_id, created = main.PLATFORM_STORE.reserve_usage_idempotent(
            usage_key, "member", "image", 1, "canvas-image", "gpt-image-2"
        )
        self.assertTrue(created)
        task_id = "canvas_img_terminal_test"
        main.PLATFORM_STORE.claim_generation_task(
            task_id,
            user["id"],
            "canvas-image",
            payload.request_id,
            main.generation_fingerprint(payload),
            main.generation_payload_dict(payload),
            usage_event_id,
        )
        main.PLATFORM_STORE.set_usage_task_id(usage_event_id, task_id)
        terminal = HTTPException(status_code=502, detail="生图任务失败")
        setattr(terminal, "upstream_task_id", "upstream-terminal-test")
        with patch.object(main, "build_online_image_result", new=AsyncMock(side_effect=terminal)):
            asyncio.run(main.run_canvas_image_task(
                task_id, payload, user["id"], "member", usage_event_id
            ))

        first = main.load_canvas_task(task_id, user["id"])
        second = main.load_canvas_task(task_id, user["id"])
        self.assertEqual(first["status"], "unknown")
        self.assertEqual(second["status"], "unknown")
        usage = main.PLATFORM_STORE.usage_by_idempotency_key(usage_key)
        self.assertEqual(usage["status"], "reserved")
        self.assertEqual(usage["refunded_points"], 0)
        with main.PLATFORM_STORE.connect() as connection:
            refunds = connection.execute(
                "SELECT COUNT(*) AS count FROM platform_credit_ledger WHERE usage_event_id=? AND action='usage_refund'",
                (usage_event_id,),
            ).fetchone()["count"]
        self.assertEqual(refunds, 0)

    def test_canvas_poll_interruption_keeps_task_and_usage_recoverable(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        payload = main.OnlineImageRequest(
            prompt="端午礼盒海报",
            provider_id="custom-api",
            model="gpt-image-2",
            size="2048x2048",
            n=1,
            request_id="request-canvas-unknown",
        )
        usage_key = "generation:member:canvas-unknown"
        usage_event_id, _ = main.PLATFORM_STORE.reserve_usage_idempotent(
            usage_key, "member", "image", 1, "canvas-image", "gpt-image-2"
        )
        task_id = "canvas_img_unknown_test"
        main.PLATFORM_STORE.claim_generation_task(
            task_id,
            user["id"],
            "canvas-image",
            payload.request_id,
            main.generation_fingerprint(payload),
            main.generation_payload_dict(payload),
            usage_event_id,
        )
        upstream_request = httpx.Request("GET", "https://ai.comfly.org/v1/images/tasks/upstream-unknown-test")
        interrupted = httpx.RemoteProtocolError("poll disconnected", request=upstream_request)
        setattr(interrupted, "upstream_task_id", "upstream-unknown-test")
        with patch.object(main, "build_online_image_result", new=AsyncMock(side_effect=interrupted)):
            asyncio.run(main.run_canvas_image_task(
                task_id, payload, user["id"], "member", usage_event_id
            ))

        task = main.load_canvas_task(task_id, user["id"])
        usage = main.PLATFORM_STORE.usage_by_idempotency_key(usage_key)
        self.assertEqual(task["status"], "unknown")
        self.assertEqual(task["upstream_task_id"], "upstream-unknown-test")
        self.assertEqual(usage["status"], "reserved")
        self.assertEqual(usage["refunded_points"], 0)

    def test_canvas_success_persists_the_client_request_id(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        payload = main.OnlineImageRequest(
            prompt="端午礼盒海报",
            provider_id="custom-api",
            model="gpt-image-2",
            request_id="request-canvas-success",
        )
        task_id = "canvas_img_success_test"
        main.PLATFORM_STORE.claim_generation_task(
            task_id,
            user["id"],
            "canvas-image",
            payload.request_id,
            main.generation_fingerprint(payload),
            main.generation_payload_dict(payload),
        )
        with patch.object(
            main,
            "build_online_image_result",
            new=AsyncMock(return_value={"images": ["/assets/output/result.png"], "request_id": "upstream-id"}),
        ):
            asyncio.run(main.run_canvas_image_task(task_id, payload, user["id"], "member"))

        task = main.load_canvas_task(task_id, user["id"])
        self.assertEqual(task["status"], "succeeded")
        self.assertEqual(task["result"]["request_id"], payload.request_id)

    def test_canvas_image_submission_returns_task_and_replays_without_resubmitting(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})

        async def delayed_result(*_args, **_kwargs):
            await asyncio.sleep(0.05)
            return {"images": ["/assets/output/angle.png"]}

        body = {
            "prompt": "向右旋转 30 度",
            "provider_id": "custom-api",
            "model": "gpt-image-2",
            "type": "angle",
            "request_id": "request-angle-task",
        }
        scheduled = []
        with (
            patch.object(main, "build_online_image_result", new=AsyncMock(side_effect=delayed_result)) as upstream,
            patch.object(main, "schedule_generation_task", side_effect=lambda coroutine: scheduled.append(coroutine)),
        ):
            first = self.user_client.post("/api/canvas-image-tasks", json=body)
            replay = self.user_client.post("/api/canvas-image-tasks", json=body)
            self.assertEqual(first.status_code, 200, first.text)
            self.assertEqual(replay.status_code, 200, replay.text)
            self.assertEqual(first.json()["task_id"], replay.json()["task_id"])
            self.assertTrue(replay.json()["idempotent_replay"])
            self.assertEqual(len(scheduled), 1)
            asyncio.run(scheduled[0])

            task_id = first.json()["task_id"]
            task = self.user_client.get(f"/api/canvas-image-tasks/{task_id}").json()

        self.assertEqual(task.get("status"), "succeeded")
        self.assertEqual(task["result"]["request_id"], body["request_id"])
        self.assertEqual(upstream.await_count, 1)

    def test_canvas_image_quota_failure_does_not_leave_a_queued_task(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})
        body = {
            "prompt": "向右旋转 30 度",
            "provider_id": "custom-api",
            "model": "gpt-image-2",
            "type": "angle",
            "request_id": "request-angle-no-quota",
        }

        with patch.object(main, "schedule_generation_task") as create_task:
            response = self.user_client.post("/api/canvas-image-tasks", json=body)

        self.assertEqual(response.status_code, 402)
        create_task.assert_not_called()
        task = self.user_client.get(
            "/api/generation-tasks/by-request/request-angle-no-quota?operation=canvas-image"
        )
        self.assertEqual(task.status_code, 200)
        self.assertEqual(task.json()["status"], "failed")

    def test_generation_background_task_is_held_until_completion(self):
        async def scenario():
            gate = asyncio.Event()

            async def work():
                await gate.wait()

            task = main.schedule_generation_task(work())
            self.assertIn(task, main.GENERATION_BACKGROUND_TASKS)
            gate.set()
            await task
            await asyncio.sleep(0)
            self.assertNotIn(task, main.GENERATION_BACKGROUND_TASKS)

        asyncio.run(scenario())

    def test_comfly_image_edit_uses_async_endpoint_and_keeps_non_comfly_url_unchanged(self):
        calls = []
        uploaded = []
        source = self.root / "source.jpg"
        Image.new("RGB", (1000, 1000), (30, 90, 150)).save(source, format="JPEG")
        original_bytes = source.read_bytes()

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return False

            async def post(self, url, **kwargs):
                calls.append(("POST", url, kwargs))
                for field, (name, stream, content_type) in kwargs.get("files", []):
                    uploaded.append((field, name, content_type, stream.read()))
                    stream.seek(0)
                return httpx.Response(200, json={"task_id": "task-comfly-edit-1"}, request=httpx.Request("POST", url))

            async def request(self, method, url, **kwargs):
                calls.append((method, url, kwargs))
                return httpx.Response(
                    200,
                    json={
                        "code": "success",
                        "data": {
                            "status": "SUCCESS",
                            "data": {"data": [{"url": "https://cdn.example.invalid/edited.png"}]},
                        },
                    },
                    request=httpx.Request(method, url),
                )

        provider = {
            "id": "custom-api",
            "name": "comfly",
            "base_url": "https://ai.comfly.org/v1",
            "protocol": "openai",
            "image_request_mode": "openai",
            "image_models": ["gpt-image-2"],
        }
        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "provider_env_key_value", return_value="secret"),
            patch.object(main, "output_file_from_url", return_value=str(source)),
            patch.object(main.httpx, "AsyncClient", FakeClient),
        ):
            image, _raw = asyncio.run(main.generate_ai_image(
                "调整标题位置",
                "1440x1440",
                "auto",
                "gpt-image-2",
                reference_images=[{"url": "/assets/source.png", "name": "源图"}],
                provider_id="custom-api",
                request_id="request-edit-1",
            ))

        self.assertEqual(image["value"], "https://cdn.example.invalid/edited.png")
        self.assertEqual(calls[0][0], "POST")
        self.assertEqual(calls[0][1], "https://ai.comfly.org/v1/images/edits?async=true")
        self.assertEqual(len([call for call in calls if call[0] == "POST"]), 1)
        self.assertEqual(calls[0][2]["data"]["model"], "gpt-image-2")
        self.assertEqual(calls[0][2]["data"]["size"], "1440x1440")
        self.assertEqual(calls[0][2]["headers"]["X-Request-ID"], "request-edit-1")
        self.assertEqual([(field, name, content_type) for field, name, content_type, _data in uploaded], [
            ("image", "source.jpg", "image/jpeg"),
        ])
        self.assertEqual(uploaded[0][3], original_bytes)
        self.assertEqual(
            main.comfly_async_image_url(
                {"base_url": "https://example.invalid/v1"},
                "https://example.invalid/v1/images/generations?mode=test",
            ),
            "https://example.invalid/v1/images/generations?mode=test",
        )

    def test_comfly_image_edit_materializes_ppt_data_url_reference(self):
        buffer = io.BytesIO()
        Image.new("RGB", (24, 18), (25, 75, 125)).save(buffer, format="JPEG")
        original_bytes = buffer.getvalue()
        data_url = f"data:image/jpeg;base64,{base64.b64encode(original_bytes).decode('ascii')}"
        uploaded = []
        temporary_paths = []

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return False

            async def post(self, url, **kwargs):
                for field, (name, stream, content_type) in kwargs.get("files", []):
                    temporary_paths.append(stream.name)
                    uploaded.append((field, name, content_type, stream.read()))
                    stream.seek(0)
                return httpx.Response(200, json={"task_id": "task-ppt-data-url"}, request=httpx.Request("POST", url))

            async def request(self, method, url, **kwargs):
                return httpx.Response(
                    200,
                    json={
                        "code": "success",
                        "data": {
                            "status": "SUCCESS",
                            "data": {"data": [{"url": "https://cdn.example.invalid/ppt-edited.png"}]},
                        },
                    },
                    request=httpx.Request(method, url),
                )

        provider = {
            "id": "custom-api",
            "name": "comfly",
            "base_url": "https://ai.comfly.org/v1",
            "protocol": "openai",
            "image_request_mode": "openai",
            "image_models": ["gpt-image-2"],
        }
        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "provider_env_key_value", return_value="secret"),
            patch.object(main.httpx, "AsyncClient", FakeClient),
        ):
            image, _raw = asyncio.run(main.generate_ai_image(
                "生成商品场景图",
                "1536x1024",
                "high",
                "gpt-image-2",
                reference_images=[{"url": data_url, "name": "PPT 上传图"}],
                provider_id="custom-api",
                request_id="request-ppt-data-url",
            ))

        self.assertEqual(image["value"], "https://cdn.example.invalid/ppt-edited.png")
        self.assertEqual(len(uploaded), 1)
        self.assertEqual(uploaded[0][0], "image")
        self.assertEqual(uploaded[0][2], "image/jpeg")
        self.assertEqual(uploaded[0][3], original_bytes)
        self.assertTrue(temporary_paths)
        self.assertTrue(all(not Path(path).exists() for path in temporary_paths))

    def test_comfly_nano_banana_edit_keeps_original_upload_format(self):
        uploaded = []
        source = self.root / "nano-source.jpg"
        Image.new("RGB", (32, 24), (120, 80, 40)).save(source, format="JPEG")
        original_bytes = source.read_bytes()

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return False

            async def post(self, url, **kwargs):
                for field, (name, stream, content_type) in kwargs.get("files", []):
                    uploaded.append((field, name, content_type, stream.read()))
                    stream.seek(0)
                return httpx.Response(
                    200,
                    json={"data": [{"url": "https://cdn.example.invalid/nano-result.png"}]},
                    request=httpx.Request("POST", url),
                )

        provider = {
            "id": "custom-api",
            "name": "comfly",
            "base_url": "https://ai.comfly.org/v1",
            "protocol": "openai",
            "image_request_mode": "openai",
            "image_models": ["nano-banana-pro"],
        }
        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "provider_env_key_value", return_value="secret"),
            patch.object(main, "output_file_from_url", return_value=str(source)),
            patch.object(main.httpx, "AsyncClient", FakeClient),
        ):
            image, _raw = asyncio.run(main.generate_ai_image(
                "调整产品图",
                "1024x1024",
                "auto",
                "nano-banana-pro",
                reference_images=[{"url": "/assets/nano-source.jpg", "name": "源图"}],
                provider_id="custom-api",
            ))

        self.assertEqual(image["value"], "https://cdn.example.invalid/nano-result.png")
        self.assertEqual(uploaded[0][:3], ("image", "nano-source.jpg", "image/jpeg"))
        self.assertEqual(uploaded[0][3], original_bytes)

    def test_comfly_mask_edit_uploads_one_composited_rgba_image(self):
        uploaded = []
        source = self.root / "source.png"
        Image.new("RGB", (8, 8), (20, 40, 80)).save(source, format="PNG")
        mask = self.root / "source_mask.png"
        mask_image = Image.new("RGBA", (8, 8), (0, 0, 0, 255))
        mask_image.putpixel((2, 3), (0, 0, 0, 0))
        mask_image.save(mask, format="PNG")

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, traceback):
                return False

            async def post(self, url, **kwargs):
                for field, (_name, stream, _content_type) in kwargs.get("files", []):
                    uploaded.append((field, stream.read()))
                    stream.seek(0)
                return httpx.Response(200, json={"task_id": "task-comfly-mask-1"}, request=httpx.Request("POST", url))

            async def request(self, method, url, **kwargs):
                return httpx.Response(
                    200,
                    json={
                        "code": "success",
                        "data": {
                            "status": "SUCCESS",
                            "data": {"data": [{"url": "https://cdn.example.invalid/masked.png"}]},
                        },
                    },
                    request=httpx.Request(method, url),
                )

        provider = {
            "id": "custom-api",
            "name": "comfly",
            "base_url": "https://ai.comfly.org/v1",
            "protocol": "openai",
            "image_request_mode": "openai",
            "image_models": ["gpt-image-2"],
        }

        def resolve_reference(url):
            return str(mask if "mask" in url else source)

        with (
            patch.object(main, "get_api_provider", return_value=provider),
            patch.object(main, "provider_env_key_value", return_value="secret"),
            patch.object(main, "output_file_from_url", side_effect=resolve_reference),
            patch.object(main.httpx, "AsyncClient", FakeClient),
        ):
            image, _raw = asyncio.run(main.generate_ai_image(
                "替换透明区域",
                "1024x1024",
                "auto",
                "gpt-image-2",
                reference_images=[
                    {"url": "/assets/source.png", "name": "源图"},
                    {"url": "/assets/source_mask.png", "name": "源图_mask.png", "role": "mask"},
                ],
                provider_id="custom-api",
            ))

        self.assertEqual(image["value"], "https://cdn.example.invalid/masked.png")
        self.assertEqual([field for field, _data in uploaded], ["image"])
        with Image.open(io.BytesIO(uploaded[0][1])) as normalized:
            self.assertEqual(normalized.format, "PNG")
            self.assertEqual(normalized.mode, "RGBA")
            composited = normalized.convert("RGBA")
            self.assertEqual(composited.getpixel((0, 0)), (20, 40, 80, 255))
            self.assertEqual(composited.getpixel((2, 3)), (255, 255, 255, 0))

    def test_chat_agent_unknown_result_is_persisted_and_not_resubmitted(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})
        provider = {"id": "test-provider", "image_models": ["test-image-model"]}
        upstream_request = httpx.Request("POST", "https://example.invalid/v1/images/generations")
        disconnect = httpx.RemoteProtocolError("response disconnected", request=upstream_request)
        original_conversation_dir = main.CONVERSATION_DIR
        main.CONVERSATION_DIR = str(self.root / "conversations")
        try:
            with (
                patch.object(main, "pick_chat_image_provider", return_value=provider),
                patch.object(main, "generate_ai_image", new=AsyncMock(side_effect=disconnect)) as generate_mock,
            ):
                payload = {
                    "request_id": "request-unknown-1",
                    "message": "生成一张端午礼盒海报",
                    "mode": "image",
                    "image_provider": "test-provider",
                    "image_model": "test-image-model",
                }
                first = self.user_client.post("/api/chat/agent", json=payload)
                second = self.user_client.post("/api/chat/agent", json=payload)

            self.assertEqual(first.status_code, 502)
            self.assertEqual(first.json()["detail"]["code"], "generation_outcome_unknown")
            self.assertEqual(first.json()["detail"]["request_id"], "request-unknown-1")
            self.assertEqual(second.status_code, 409)
            self.assertEqual(generate_mock.await_count, 1)
            records = list((self.root / "conversations").rglob("*.json"))
            self.assertEqual(len(records), 1)
            conversation = json.loads(records[0].read_text(encoding="utf-8"))
            self.assertEqual(conversation["messages"][-1]["status"], "outcome_unknown")
            self.assertEqual(conversation["messages"][-1]["request_id"], "request-unknown-1")
            usage = main.PLATFORM_STORE.usage_by_idempotency_key(
                main.api_usage_idempotency_key("member", "chat-agent", "request-unknown-1")
            )
            self.assertEqual(usage["status"], "reserved")
            self.assertEqual(main.PLATFORM_STORE.user_balance(user["id"])["balance"], 9)
            self.assertEqual(main.PLATFORM_STORE.user_balance(user["id"])["available"], 9)
            self.assertEqual(main.PLATFORM_STORE.overview()["usage"]["failed_tasks"], 0)
        finally:
            main.CONVERSATION_DIR = original_conversation_dir

    def test_chat_agent_status_recovers_unknown_async_result_once(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})
        original_conversation_dir = main.CONVERSATION_DIR
        main.CONVERSATION_DIR = str(self.root / "conversations")
        request_id = "request-recover-unknown-1"
        task_id = "task-recover-unknown-1"
        storage_user_id = f"user-{user['id']}"
        usage_key = main.api_usage_idempotency_key("member", "chat-agent", request_id)
        try:
            conversation = main.new_conversation(storage_user_id, "Recovery test")
            conversation["messages"] = [
                {
                    "id": "user-recover-1",
                    "role": "user",
                    "content": "Generate a festival poster",
                    "created_at": main.now_ms(),
                    "request_id": request_id,
                    "attachments": [],
                    "request_context": {
                        "image_provider": "test-provider",
                        "image_model": "test-image-model",
                        "size": "1024x1024",
                        "generation_prompt": "A green festival poster",
                        "action": "generate_image",
                    },
                },
                {
                    "id": "assistant-unknown-1",
                    "role": "assistant",
                    "type": "error",
                    "status": "outcome_unknown",
                    "content": "The upstream response was interrupted",
                    "created_at": main.now_ms(),
                    "request_id": request_id,
                    "provider": "test-provider",
                    "model": "test-image-model",
                    "error_detail": {
                        "code": "generation_outcome_unknown",
                        "upstream_task_id": task_id,
                        "upstream_outcome": "unknown",
                    },
                },
            ]
            main.save_conversation(storage_user_id, conversation)
            usage_event_id, created = main.PLATFORM_STORE.reserve_usage_idempotent(
                usage_key, "member", "image", 1, "chat-agent", "test-image-model"
            )
            self.assertTrue(created)
            main.PLATFORM_STORE.set_usage_task_id(usage_event_id, task_id)

            recovered_task = {
                "status": "succeeded",
                "task_id": task_id,
                "images": ["/assets/output/recovered.png"],
            }
            original_reconcile_usage = main.PLATFORM_STORE.reconcile_usage_success
            with (
                patch.object(main, "query_image_task_result", new=AsyncMock(return_value=recovered_task)) as query_mock,
                patch.object(main.PLATFORM_STORE, "reconcile_usage_success", wraps=original_reconcile_usage) as reconcile_mock,
            ):
                first = self.user_client.get(f"/api/chat/agent/requests/{request_id}")
                second = self.user_client.get(f"/api/chat/agent/requests/{request_id}")

            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.json()["status"], "succeeded")
            self.assertTrue(first.json()["agent"]["recovered"])
            self.assertEqual(first.json()["message"]["image_url"], "/assets/output/recovered.png")
            self.assertEqual(second.status_code, 200)
            self.assertEqual(second.json()["status"], "succeeded")
            self.assertEqual(second.json()["message"]["id"], first.json()["message"]["id"])
            self.assertEqual(reconcile_mock.call_count, 1)
            self.assertEqual(query_mock.await_count, 1)

            saved = main.load_conversation(storage_user_id, conversation["id"])
            matching = [item for item in saved["messages"] if item.get("request_id") == request_id]
            self.assertEqual(len(matching), 2)
            self.assertEqual(matching[-1]["type"], "image")
            self.assertEqual(matching[-1]["recovered_from_task_id"], task_id)
            usage = main.PLATFORM_STORE.usage_by_idempotency_key(usage_key)
            self.assertEqual(usage["status"], "succeeded")
            self.assertEqual(usage["output_units"], 1)
            self.assertEqual(main.PLATFORM_STORE.user_balance(user["id"])["balance"], 9)
            self.assertEqual(main.PLATFORM_STORE.overview()["usage"]["image_outputs"], 1)
        finally:
            main.CONVERSATION_DIR = original_conversation_dir

    def test_chat_agent_status_recovers_restart_state_without_assistant_record(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})
        original_conversation_dir = main.CONVERSATION_DIR
        main.CONVERSATION_DIR = str(self.root / "conversations")
        request_id = "request-recover-restart-1"
        task_id = "task-recover-restart-1"
        storage_user_id = f"user-{user['id']}"
        usage_key = main.api_usage_idempotency_key("member", "chat-agent", request_id)
        try:
            conversation = main.new_conversation(storage_user_id, "Restart recovery test")
            conversation["messages"] = [
                {
                    "id": "user-restart-1",
                    "role": "user",
                    "content": "Generate a product poster",
                    "created_at": main.now_ms(),
                    "request_id": request_id,
                    "attachments": [],
                    "request_context": {
                        "image_provider": "test-provider",
                        "image_model": "test-image-model",
                        "size": "1024x1024",
                        "generation_prompt": "A product poster",
                        "action": "generate_image",
                    },
                }
            ]
            main.save_conversation(storage_user_id, conversation)
            usage_event_id, created = main.PLATFORM_STORE.reserve_usage_idempotent(
                usage_key, "member", "image", 1, "chat-agent", "test-image-model"
            )
            self.assertTrue(created)
            main.PLATFORM_STORE.set_usage_task_id(usage_event_id, task_id)

            with patch.object(
                main,
                "query_image_task_result",
                new=AsyncMock(return_value={
                    "status": "succeeded",
                    "task_id": task_id,
                    "images": ["/assets/output/restart-recovered.png"],
                }),
            ) as query_mock:
                response = self.user_client.get(f"/api/chat/agent/requests/{request_id}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "succeeded")
            self.assertEqual(response.json()["message"]["image_url"], "/assets/output/restart-recovered.png")
            self.assertEqual(query_mock.await_count, 1)
            saved = main.load_conversation(storage_user_id, conversation["id"])
            matching = [item for item in saved["messages"] if item.get("request_id") == request_id]
            self.assertEqual([item["role"] for item in matching], ["user", "assistant"])
            self.assertEqual(matching[-1]["recovered_from_task_id"], task_id)
            self.assertEqual(main.PLATFORM_STORE.usage_by_idempotency_key(usage_key)["status"], "succeeded")
            self.assertEqual(main.PLATFORM_STORE.user_balance(user["id"])["balance"], 9)
        finally:
            main.CONVERSATION_DIR = original_conversation_dir

    def test_chat_agent_restart_during_submission_keeps_unknown_reservation(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})
        original_conversation_dir = main.CONVERSATION_DIR
        main.CONVERSATION_DIR = str(self.root / "conversations")
        request_id = "request-interrupted-before-submit-1"
        storage_user_id = f"user-{user['id']}"
        usage_key = main.api_usage_idempotency_key("member", "chat-agent", request_id)
        try:
            conversation = main.new_conversation(storage_user_id, "Interrupted request")
            conversation["messages"] = [{
                "id": "user-interrupted-1",
                "role": "user",
                "content": "Generate a product poster",
                "created_at": main.now_ms(),
                "request_id": request_id,
                "request_context": {
                    "image_provider": "test-provider",
                    "image_model": "test-image-model",
                    "generation_status": "submitting",
                    "generation_started_at": main.now_ms() - (31 * 60 * 1000),
                    "executor_id": f"{main.CHAT_REQUEST_EXECUTOR_ID}-old-process",
                },
            }]
            main.save_conversation(storage_user_id, conversation)
            event_id, created = main.PLATFORM_STORE.reserve_usage_idempotent(
                usage_key, "member", "image", 1, "chat-agent", "test-image-model"
            )
            self.assertTrue(created)
            self.assertEqual(main.PLATFORM_STORE.usage_by_idempotency_key(usage_key)["external_task_id"], "")

            first = self.user_client.get(f"/api/chat/agent/requests/{request_id}")
            second = self.user_client.get(f"/api/chat/agent/requests/{request_id}")

            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.json()["status"], "outcome_unknown")
            self.assertEqual(first.json()["detail"]["code"], "generation_outcome_unknown")
            self.assertEqual(first.json()["detail"]["upstream_outcome"], "unknown")
            self.assertFalse(first.json()["detail"]["retryable"])
            self.assertEqual(second.json()["message"]["id"], first.json()["message"]["id"])
            self.assertEqual(main.PLATFORM_STORE.usage_by_idempotency_key(usage_key)["status"], "reserved")
            self.assertEqual(main.PLATFORM_STORE.user_balance(user["id"])["balance"], 9)
        finally:
            main.CONVERSATION_DIR = original_conversation_dir

    def test_chat_agent_unknown_provider_failure_is_persisted_and_polled_once(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})
        original_conversation_dir = main.CONVERSATION_DIR
        main.CONVERSATION_DIR = str(self.root / "conversations")
        request_id = "request-unknown-then-failed-1"
        task_id = "task-unknown-then-failed-1"
        storage_user_id = f"user-{user['id']}"
        usage_key = main.api_usage_idempotency_key("member", "chat-agent", request_id)
        try:
            conversation = main.new_conversation(storage_user_id, "Unknown then failed")
            conversation["messages"] = [
                {
                    "id": "user-unknown-then-failed-1",
                    "role": "user",
                    "content": "Generate a poster",
                    "created_at": main.now_ms(),
                    "request_id": request_id,
                    "request_context": {
                        "image_provider": "test-provider",
                        "image_model": "test-image-model",
                        "action": "generate_image",
                    },
                },
                {
                    "id": "assistant-unknown-then-failed-1",
                    "role": "assistant",
                    "type": "error",
                    "status": "outcome_unknown",
                    "content": "Provider outcome is unknown",
                    "created_at": main.now_ms(),
                    "request_id": request_id,
                    "provider": "test-provider",
                    "model": "test-image-model",
                    "error_detail": {
                        "code": "generation_outcome_unknown",
                        "upstream_task_id": task_id,
                        "upstream_outcome": "unknown",
                        "retryable": False,
                    },
                },
            ]
            main.save_conversation(storage_user_id, conversation)
            event_id, created = main.PLATFORM_STORE.reserve_usage_idempotent(
                usage_key, "member", "image", 1, "chat-agent", "test-image-model"
            )
            self.assertTrue(created)
            main.PLATFORM_STORE.set_usage_task_id(event_id, task_id)

            with patch.object(
                main,
                "query_image_task_result",
                new=AsyncMock(return_value={
                    "status": "failed",
                    "task_id": task_id,
                    "error": "provider rejected the image",
                }),
            ) as query_mock:
                first = self.user_client.get(f"/api/chat/agent/requests/{request_id}")
                second = self.user_client.get(f"/api/chat/agent/requests/{request_id}")

            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.json()["status"], "failed")
            self.assertEqual(first.json()["detail"]["upstream_outcome"], "failed")
            self.assertEqual(second.json()["status"], "failed")
            self.assertEqual(second.json()["message"]["id"], first.json()["message"]["id"])
            self.assertEqual(query_mock.await_count, 1)
            saved = main.load_conversation(storage_user_id, conversation["id"])
            matching = [item for item in saved["messages"] if item.get("request_id") == request_id]
            self.assertEqual(len(matching), 2)
            self.assertEqual(matching[-1]["status"], "failed")
            self.assertEqual(matching[-1]["error_detail"]["upstream_outcome"], "failed")
            self.assertEqual(main.PLATFORM_STORE.usage_by_idempotency_key(usage_key)["status"], "failed")
            self.assertEqual(main.PLATFORM_STORE.user_balance(user["id"])["balance"], 10)
        finally:
            main.CONVERSATION_DIR = original_conversation_dir

    def test_chat_agent_expired_recovery_error_fails_and_releases_reservation(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})
        original_conversation_dir = main.CONVERSATION_DIR
        main.CONVERSATION_DIR = str(self.root / "conversations")
        request_id = "request-expired-recovery-error-1"
        task_id = "task-expired-recovery-error-1"
        storage_user_id = f"user-{user['id']}"
        usage_key = main.api_usage_idempotency_key("member", "chat-agent", request_id)
        try:
            conversation = main.new_conversation(storage_user_id, "Expired recovery")
            conversation["messages"] = [{
                "id": "user-expired-recovery-1",
                "role": "user",
                "content": "Generate a poster",
                "created_at": main.now_ms() - (31 * 60 * 1000),
                "request_id": request_id,
                "request_context": {
                    "image_provider": "test-provider",
                    "image_model": "test-image-model",
                    "action": "generate_image",
                    "generation_status": "submitted",
                    "generation_started_at": main.now_ms() - (31 * 60 * 1000),
                },
            }]
            main.save_conversation(storage_user_id, conversation)
            event_id, created = main.PLATFORM_STORE.reserve_usage_idempotent(
                usage_key, "member", "image", 1, "chat-agent", "test-image-model"
            )
            self.assertTrue(created)
            main.PLATFORM_STORE.set_usage_task_id(event_id, task_id)

            with patch.object(
                main,
                "query_image_task_result",
                new=AsyncMock(side_effect=HTTPException(status_code=404, detail="task not found")),
            ) as query_mock:
                first = self.user_client.get(f"/api/chat/agent/requests/{request_id}")
                second = self.user_client.get(f"/api/chat/agent/requests/{request_id}")

            self.assertEqual(first.status_code, 200)
            self.assertEqual(first.json()["status"], "failed")
            self.assertEqual(first.json()["detail"]["code"], "generation_recovery_expired")
            self.assertEqual(first.json()["detail"]["upstream_task_id"], task_id)
            self.assertEqual(second.json()["status"], "failed")
            self.assertEqual(query_mock.await_count, 1)
            self.assertEqual(main.PLATFORM_STORE.usage_by_idempotency_key(usage_key)["status"], "failed")
            self.assertEqual(main.PLATFORM_STORE.user_balance(user["id"])["balance"], 10)
        finally:
            main.CONVERSATION_DIR = original_conversation_dir

    def test_chat_agent_partial_multi_image_recovery_never_reports_success(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})
        original_conversation_dir = main.CONVERSATION_DIR
        main.CONVERSATION_DIR = str(self.root / "conversations")
        request_id = "request-partial-multi-recovery-1"
        task_id = "task-partial-multi-recovery-1"
        storage_user_id = f"user-{user['id']}"
        usage_key = main.api_usage_idempotency_key("member", "chat-agent", request_id)
        partial_url = "/assets/output/recovered-one-of-two.png"
        try:
            conversation = main.new_conversation(storage_user_id, "Partial multi-image recovery")
            conversation["messages"] = [{
                "id": "user-partial-recovery-1",
                "role": "user",
                "content": "Generate two poster variants",
                "created_at": main.now_ms(),
                "request_id": request_id,
                "request_context": {
                    "image_provider": "test-provider",
                    "image_model": "test-image-model",
                    "action": "generate_image",
                    "generation_prompt": "Two poster variants",
                    "requested_count": 2,
                    "prompts": ["Poster variant one", "Poster variant two"],
                    "completed_images": [],
                },
            }]
            main.save_conversation(storage_user_id, conversation)
            event_id, created = main.PLATFORM_STORE.reserve_usage_idempotent(
                usage_key, "member", "image", 2, "chat-agent", "test-image-model"
            )
            self.assertTrue(created)
            main.PLATFORM_STORE.set_usage_task_id(event_id, task_id)

            with patch.object(
                main,
                "query_image_task_result",
                new=AsyncMock(return_value={
                    "status": "succeeded",
                    "task_id": task_id,
                    "images": [partial_url],
                }),
            ):
                response = self.user_client.get(f"/api/chat/agent/requests/{request_id}")

            self.assertEqual(response.status_code, 200)
            self.assertNotEqual(response.json()["status"], "succeeded")
            self.assertEqual(response.json()["detail"]["requested_count"], 2)
            self.assertEqual(response.json()["detail"]["partial_image_urls"], [partial_url])
            saved = main.load_conversation(storage_user_id, conversation["id"])
            matching = [item for item in saved["messages"] if item.get("request_id") == request_id]
            self.assertEqual(matching[-1]["error_detail"]["requested_count"], 2)
            self.assertEqual(matching[-1]["error_detail"]["partial_image_urls"], [partial_url])
        finally:
            main.CONVERSATION_DIR = original_conversation_dir

    def test_chat_agent_status_repairs_success_persisted_before_usage_settlement(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})
        original_conversation_dir = main.CONVERSATION_DIR
        main.CONVERSATION_DIR = str(self.root / "conversations")
        request_id = "request-persisted-before-billing-1"
        usage_key = main.api_usage_idempotency_key("member", "chat-agent", request_id)
        try:
            conversation = main.new_conversation(f"user-{user['id']}", "Billing recovery")
            conversation["messages"] = [
                {"id": "user-1", "role": "user", "content": "poster", "request_id": request_id},
                {
                    "id": "assistant-1", "role": "assistant", "type": "image", "content": "poster",
                    "request_id": request_id, "image_url": "/assets/output/result.png",
                    "image_urls": ["/assets/output/result.png"],
                },
            ]
            main.save_conversation(f"user-{user['id']}", conversation)
            event_id, created = main.PLATFORM_STORE.reserve_usage_idempotent(
                usage_key, "member", "image", 1, "chat-agent", "test-image-model"
            )
            self.assertTrue(created)

            first = self.user_client.get(f"/api/chat/agent/requests/{request_id}")
            second = self.user_client.get(f"/api/chat/agent/requests/{request_id}")

            self.assertEqual(first.json()["status"], "succeeded")
            self.assertEqual(second.json()["message"]["id"], "assistant-1")
            self.assertEqual(main.PLATFORM_STORE.usage_by_idempotency_key(usage_key)["status"], "succeeded")
            self.assertEqual(main.PLATFORM_STORE.user_balance(user["id"])["balance"], 9)
        finally:
            main.CONVERSATION_DIR = original_conversation_dir

    def test_chat_agent_status_repairs_failure_persisted_before_usage_settlement(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})
        original_conversation_dir = main.CONVERSATION_DIR
        main.CONVERSATION_DIR = str(self.root / "conversations")
        request_id = "request-failure-before-billing-1"
        usage_key = main.api_usage_idempotency_key("member", "chat-agent", request_id)
        try:
            conversation = main.new_conversation(f"user-{user['id']}", "Failure recovery")
            conversation["messages"] = [
                {"id": "user-1", "role": "user", "content": "poster", "request_id": request_id},
                {
                    "id": "assistant-error-1", "role": "assistant", "type": "error", "status": "failed",
                    "content": "provider failed", "request_id": request_id,
                    "error_detail": {"message": "provider failed", "upstream_outcome": "failed", "retryable": True},
                },
            ]
            main.save_conversation(f"user-{user['id']}", conversation)
            event_id, created = main.PLATFORM_STORE.reserve_usage_idempotent(
                usage_key, "member", "image", 1, "chat-agent", "test-image-model"
            )
            self.assertTrue(created)

            response = self.user_client.get(f"/api/chat/agent/requests/{request_id}")

            self.assertEqual(response.json()["status"], "failed")
            self.assertEqual(main.PLATFORM_STORE.usage_by_idempotency_key(usage_key)["status"], "failed")
            self.assertEqual(main.PLATFORM_STORE.user_balance(user["id"])["balance"], 10)
        finally:
            main.CONVERSATION_DIR = original_conversation_dir

    def test_chat_agent_success_replays_without_second_generation_or_charge(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})
        provider = {"id": "test-provider", "image_models": ["test-image-model"]}
        original_conversation_dir = main.CONVERSATION_DIR
        main.CONVERSATION_DIR = str(self.root / "conversations")
        try:
            with (
                patch.object(main, "pick_chat_image_provider", return_value=provider),
                patch.object(main, "generate_ai_image", new=AsyncMock(return_value=(b"image", {}))) as generate_mock,
                patch.object(main, "save_ai_image_to_output", new=AsyncMock(return_value="/assets/output/test.png")),
            ):
                payload = {
                    "request_id": "request-success-1",
                    "message": "生成一张端午礼盒海报",
                    "mode": "image",
                    "image_provider": "test-provider",
                    "image_model": "test-image-model",
                }
                first = self.user_client.post("/api/chat/agent", json=payload)
                status = self.user_client.get("/api/chat/agent/requests/request-success-1")
                second = self.user_client.post("/api/chat/agent", json=payload)

            self.assertEqual(first.status_code, 200)
            self.assertEqual(status.status_code, 200)
            self.assertEqual(status.json()["status"], "succeeded")
            self.assertEqual(status.json()["message"]["id"], first.json()["message"]["id"])
            self.assertEqual(second.status_code, 200)
            self.assertTrue(second.json()["agent"]["replayed"])
            self.assertEqual(first.json()["message"]["id"], second.json()["message"]["id"])
            self.assertEqual(generate_mock.await_count, 1)
            self.assertEqual(main.PLATFORM_STORE.user_balance(user["id"])["balance"], 9)
            self.assertEqual(main.PLATFORM_STORE.overview()["usage"]["image_outputs"], 1)
        finally:
            main.CONVERSATION_DIR = original_conversation_dir

    def test_chat_agent_normalizes_request_id_before_usage_reservation(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})
        provider = {"id": "test-provider", "image_models": ["test-image-model"]}
        original_conversation_dir = main.CONVERSATION_DIR
        main.CONVERSATION_DIR = str(self.root / "conversations")
        try:
            with (
                patch.object(main, "pick_chat_image_provider", return_value=provider),
                patch.object(main, "generate_ai_image", new=AsyncMock(return_value=(b"image", {}))) as generate_mock,
                patch.object(main, "save_ai_image_to_output", new=AsyncMock(return_value="/assets/output/test.png")),
            ):
                base = {
                    "message": "生成一张端午礼盒海报",
                    "mode": "image",
                    "image_provider": "test-provider",
                    "image_model": "test-image-model",
                }
                first = self.user_client.post("/api/chat/agent", json={**base, "request_id": "request alias 1"})
                second = self.user_client.post("/api/chat/agent", json={**base, "request_id": "request-alias-1"})

            self.assertEqual(first.status_code, 200)
            self.assertEqual(second.status_code, 200)
            self.assertTrue(second.json()["agent"]["replayed"])
            self.assertEqual(generate_mock.await_count, 1)
            self.assertEqual(main.PLATFORM_STORE.user_balance(user["id"])["balance"], 9)
            self.assertEqual(main.PLATFORM_STORE.overview()["usage"]["image_outputs"], 1)
        finally:
            main.CONVERSATION_DIR = original_conversation_dir

    def test_chat_agent_existing_usage_without_replay_record_never_resubmits(self):
        self.admin_client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
        user = main.PLATFORM_STORE.create_user("member", "password123")
        main.PLATFORM_STORE.set_user_status(user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(user["id"], "owner", "set", 10)
        self.user_client.post("/api/auth/login", json={"username": "member", "password": "password123"})
        provider = {"id": "test-provider", "image_models": ["test-image-model"]}
        original_conversation_dir = main.CONVERSATION_DIR
        main.CONVERSATION_DIR = str(self.root / "conversations")
        try:
            with (
                patch.object(main, "pick_chat_image_provider", return_value=provider),
                patch.object(main, "generate_ai_image", new=AsyncMock(return_value=(b"image", {}))) as generate_mock,
                patch.object(main, "save_ai_image_to_output", new=AsyncMock(return_value="/assets/output/test.png")),
            ):
                payload = {
                    "request_id": "request-deleted-result-1",
                    "message": "生成一张端午礼盒海报",
                    "mode": "image",
                    "image_provider": "test-provider",
                    "image_model": "test-image-model",
                }
                first = self.user_client.post("/api/chat/agent", json=payload)
                conversation_id = first.json()["conversation"]["id"]
                deleted = self.user_client.delete(f"/api/conversations/{conversation_id}")
                second = self.user_client.post("/api/chat/agent", json=payload)

            self.assertEqual(first.status_code, 200)
            self.assertEqual(deleted.status_code, 200)
            self.assertEqual(second.status_code, 409)
            self.assertEqual(second.json()["detail"]["code"], "generation_outcome_unknown")
            self.assertEqual(generate_mock.await_count, 1)
            self.assertEqual(main.PLATFORM_STORE.user_balance(user["id"])["balance"], 9)
        finally:
            main.CONVERSATION_DIR = original_conversation_dir

    def test_legacy_browser_conversation_history_binds_to_only_one_authenticated_user(self):
        from types import SimpleNamespace

        original_conversation_dir = main.CONVERSATION_DIR
        main.CONVERSATION_DIR = str(self.root / "legacy-conversations")
        legacy_id = "f7018435-e0ab-475c-ac90-12f7bd4a1648"
        legacy_dir = Path(main.CONVERSATION_DIR) / legacy_id
        legacy_dir.mkdir(parents=True)
        (legacy_dir / "history.json").write_text(
            json.dumps({"id": "history", "messages": []}), encoding="utf-8"
        )
        first_request = SimpleNamespace(
            state=SimpleNamespace(platform_user_id=1, platform_user="first"), client=None,
        )
        second_request = SimpleNamespace(
            state=SimpleNamespace(platform_user_id=2, platform_user="second"), client=None,
        )
        try:
            self.assertEqual(main.safe_user_id(legacy_id, first_request), legacy_id)
            self.assertEqual(main.safe_user_id(legacy_id, first_request), legacy_id)
            self.assertEqual(main.safe_user_id(legacy_id, second_request), "user-2")
            bindings = json.loads(
                (Path(main.CONVERSATION_DIR) / ".identity-bindings.json").read_text(encoding="utf-8")
            )
            self.assertEqual(bindings[legacy_id], "user-1")
        finally:
            main.CONVERSATION_DIR = original_conversation_dir

    def test_assistant_append_merges_messages_saved_during_generation(self):
        original_conversation_dir = main.CONVERSATION_DIR
        main.CONVERSATION_DIR = str(self.root / "conversations")
        try:
            conversation = main.new_conversation("member", "并发对话")
            conversation["messages"].append({"id": "user-1", "role": "user", "content": "第一条"})
            main.save_conversation("member", conversation)
            stale = json.loads(json.dumps(conversation))
            conversation["messages"].append({"id": "user-2", "role": "user", "content": "第二条"})
            main.save_conversation("member", conversation)

            assistant = {
                "id": "assistant-1",
                "role": "assistant",
                "content": "第一条的结果",
                "request_id": "request-1",
            }
            main.append_chat_assistant_message(stale, "member", assistant)

            saved = main.load_conversation("member", conversation["id"])
            self.assertEqual([item["id"] for item in saved["messages"]], ["user-1", "user-2", "assistant-1"])
            self.assertEqual([item["id"] for item in stale["messages"]], ["user-1", "user-2", "assistant-1"])
        finally:
            main.CONVERSATION_DIR = original_conversation_dir

    def test_user_append_merges_parallel_requests_and_deduplicates_request_id(self):
        original_conversation_dir = main.CONVERSATION_DIR
        main.CONVERSATION_DIR = str(self.root / "concurrent-conversations")
        try:
            conversation = main.new_conversation("member", "并发对话")
            first = json.loads(json.dumps(conversation))
            second = json.loads(json.dumps(conversation))

            first_message = {
                "id": "user-1",
                "role": "user",
                "content": "第一条",
                "request_id": "request-1",
            }
            second_message = {
                "id": "user-2",
                "role": "user",
                "content": "第二条",
                "request_id": "request-2",
            }
            main.append_chat_user_message(first, "member", first_message)
            main.append_chat_user_message(second, "member", second_message)
            main.append_chat_user_message(second, "member", dict(second_message, id="duplicate"))

            saved = main.load_conversation("member", conversation["id"])
            self.assertEqual([item["id"] for item in saved["messages"]], ["user-1", "user-2"])
            self.assertEqual([item["id"] for item in second["messages"]], ["user-1", "user-2"])
        finally:
            main.CONVERSATION_DIR = original_conversation_dir


if __name__ == "__main__":
    unittest.main()
