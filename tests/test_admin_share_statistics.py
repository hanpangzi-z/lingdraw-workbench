import datetime
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
from platform_admin import PlatformStore


SHANGHAI = datetime.timezone(datetime.timedelta(hours=8))


def timestamp(year, month, day, hour=0, minute=0):
    return int(datetime.datetime(year, month, day, hour, minute, tzinfo=SHANGHAI).timestamp() * 1000)


class AdminShareStatisticsTests(unittest.TestCase):
    def test_monthly_counts_include_designers_with_zero_shares(self):
        users = [
            {"id": 1, "username": "阿青", "role": "user", "status": "enabled"},
            {"id": 2, "username": "小林", "role": "user", "status": "enabled"},
            {"id": 3, "username": "未分享", "role": "user", "status": "pending"},
        ]
        items = [
            {"owner_user_id": 1, "owner_username": "阿青", "category": "创意", "created_at": timestamp(2026, 8, 1)},
            {"owner_user_id": 1, "owner_username": "阿青", "category": "banner", "created_at": timestamp(2026, 8, 31, 23, 59)},
            {"owner_user_id": 2, "owner_username": "小林", "category": "未分类", "created_at": timestamp(2026, 8, 7, 12)},
            {"owner_user_id": 2, "owner_username": "小林", "category": "创意", "created_at": timestamp(2026, 7, 31, 23, 59)},
            {"owner_user_id": 2, "owner_username": "小林", "category": "创意", "created_at": timestamp(2026, 9, 1)},
        ]

        result = main.admin_share_statistics(items, users, "2026-08")

        self.assertEqual(result["summary"]["total_shares"], 3)
        self.assertEqual(result["summary"]["total_designers"], 3)
        self.assertEqual(result["summary"]["active_designers"], 2)
        self.assertEqual(result["summary"]["average_shares"], 1.0)
        self.assertEqual(result["summary"]["top_designer"], "阿青")
        self.assertEqual([row["share_count"] for row in result["designers"]], [2, 1, 0])
        self.assertEqual(result["designers"][1]["categories"]["其他"], 1)
        self.assertEqual(result["daily_totals"][0]["count"], 1)
        self.assertEqual(result["daily_totals"][30]["count"], 1)

        searched = main.admin_share_statistics(items, users, "2026-08", "未分享")
        self.assertEqual(len(searched["designers"]), 1)
        self.assertEqual(searched["designers"][0]["share_count"], 0)
        self.assertEqual(searched["summary"]["total_shares"], 3)

    def test_admin_api_and_csv_are_protected_and_month_aware(self):
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        original_store = main.PLATFORM_STORE
        main.PLATFORM_STORE = PlatformStore(root / "users.sqlite3", root / "legacy.json")
        main.PLATFORM_STORE.initialize()
        client = TestClient(main.app)
        try:
            self.assertEqual(client.get("/api/admin/shares?month=2026-08").status_code, 401)
            client.post("/api/admin/auth/setup", json={"username": "owner", "password": "password123"})
            designer = main.PLATFORM_STORE.create_user("designer", "password123")
            main.PLATFORM_STORE.set_user_status(designer["id"], "enabled")
            store = {
                "items": [
                    {
                        "owner_user_id": designer["id"],
                        "owner_username": "designer",
                        "category": "礼品册",
                        "created_at": timestamp(2026, 8, 9, 14),
                    }
                ]
            }
            with patch.object(main, "load_inspiration_store", return_value=store):
                response = client.get("/api/admin/shares?month=2026-08")
                exported = client.get("/api/admin/export/shares.csv?month=2026-08")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["summary"]["total_shares"], 1)
            self.assertEqual(exported.status_code, 200)
            self.assertTrue(exported.content.startswith(b"\xef\xbb\xbf"))
            self.assertIn("designer", exported.content.decode("utf-8-sig"))
            invalid = client.get("/api/admin/shares?month=2026-13")
            self.assertEqual(invalid.status_code, 400)
            self.assertEqual(invalid.json()["code"], "invalid_share_month")
        finally:
            client.close()
            main.PLATFORM_STORE = original_store
            temporary.cleanup()

    def test_admin_frontend_exposes_share_statistics_view(self):
        root = Path(__file__).resolve().parents[1]
        html = (root / "static/admin-app/index.html").read_text(encoding="utf-8")
        javascript = (root / "static/admin-app/admin.js").read_text(encoding="utf-8")
        self.assertIn('data-section="shares"', html)
        self.assertIn('id="sharesSection"', html)
        self.assertIn('id="shareMonth" type="month"', html)
        self.assertIn('/api/admin/shares', javascript)
        self.assertIn("renderShareStatistics", javascript)

    def test_admin_user_table_labels_task_and_output_counts(self):
        root = Path(__file__).resolve().parents[1]
        javascript = (root / "static/admin-app/admin.js").read_text(encoding="utf-8")

        self.assertIn('任务 ${user.image_tasks}', javascript)
        self.assertIn('产出 ${user.image_outputs}', javascript)
        self.assertIn('任务 ${user.video_tasks}', javascript)
        self.assertIn('产出 ${user.video_outputs}', javascript)
        self.assertIn('任务 ${user.chat_tasks}', javascript)
        self.assertIn('产出 ${user.chat_outputs}', javascript)
        self.assertIn('任务 ${user.workflow_tasks}', javascript)
        self.assertIn('产出 ${user.workflow_outputs}', javascript)
        self.assertIn('失败 ${user.failed_tasks}', javascript)

    def test_admin_model_pricing_uses_saved_provider_catalog(self):
        root = Path(__file__).resolve().parents[1]
        html = (root / "static/admin-app/index.html").read_text(encoding="utf-8")
        javascript = (root / "static/admin-app/admin.js").read_text(encoding="utf-8")

        self.assertIn("模型积分单价", html)
        self.assertIn('id="modelPricingList"', html)
        self.assertIn('data-category-price="workflow"', html)
        self.assertIn("data.models || []", javascript)
        self.assertIn("data-model-price", javascript)
        self.assertIn("model_pricing:modelPricing", javascript)

    def test_admin_model_pricing_dialog_has_an_internal_scroll_region(self):
        root = Path(__file__).resolve().parents[1]
        html = (root / "static/admin-app/index.html").read_text(encoding="utf-8")
        css = (root / "static/admin-app/admin.css").read_text(encoding="utf-8")
        javascript = (root / "static/admin-app/admin.js").read_text(encoding="utf-8")

        self.assertIn('class="model-pricing-list" tabindex="0"', html)
        self.assertIn('aria-label="模型积分单价列表"', html)
        self.assertIn("admin-model-pricing-scrollbar-20260818-1", html)
        self.assertIn("max-height: calc(100dvh - 32px)", css)
        self.assertIn("#pricingDialog { overflow: hidden; }", css)
        self.assertIn("height: min(700px, calc(100dvh - 48px))", css)
        self.assertIn("grid-template-rows: auto auto auto minmax(0, 1fr) auto auto", css)
        self.assertIn(".model-pricing-list {", css)
        self.assertIn("max-height: min(48dvh, 470px)", css)
        self.assertIn("overflow-y: scroll", css)
        self.assertIn("overscroll-behavior: contain", css)
        self.assertIn("scrollbar-gutter: stable", css)
        self.assertIn("scrollbar-color: #64748b #e2e8f0", css)
        self.assertIn("scrollbar-width: auto", css)
        self.assertIn("grid-auto-rows: max-content", css)
        self.assertIn(".model-pricing-list::-webkit-scrollbar { width: 12px; }", css)
        self.assertIn(".model-pricing-list::-webkit-scrollbar-track", css)
        self.assertIn(".model-pricing-list::-webkit-scrollbar-thumb:hover", css)
        self.assertIn(".model-pricing-list::-webkit-scrollbar-thumb:active", css)
        self.assertIn("overflow-wrap: anywhere", css)
        self.assertIn("enableModelPricingKeyboardScroll($('#modelPricingList'))", javascript)
        self.assertIn("PageDown: () => { list.scrollTop += pageStep; }", javascript)
        self.assertIn("End: () => { list.scrollTop = list.scrollHeight; }", javascript)


if __name__ == "__main__":
    unittest.main()
