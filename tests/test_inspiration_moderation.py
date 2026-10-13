import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

import main


def request_for(user_id, role):
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
    request.state.platform_account = {
        "id": user_id,
        "username": f"user-{user_id}",
        "role": role,
    }
    return request


class InspirationModerationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store_path = Path(self.temp.name) / "inspirations.json"
        self.item = {
            "id": "shared-item",
            "category": "创意",
            "image_url": "/output/shared.png",
            "owner_user_id": 11,
            "owner_username": "publisher",
            "created_at": 1,
        }
        self.reset_store()

    def tearDown(self):
        main.invalidate_inspiration_store_cache()
        self.temp.cleanup()

    def reset_store(self):
        self.store_path.write_text(
            json.dumps({"items": [self.item]}, ensure_ascii=False),
            encoding="utf-8",
        )
        main.invalidate_inspiration_store_cache()

    def stored_items(self):
        return json.loads(self.store_path.read_text(encoding="utf-8"))["items"]

    def test_list_reports_moderation_capability_by_role(self):
        with patch.object(main, "load_inspiration_store", return_value={"items": [self.item]}):
            ordinary = asyncio.run(main.list_inspirations(request_for(11, "user")))
            admin = asyncio.run(main.list_inspirations(request_for(21, "admin")))
            super_admin = asyncio.run(main.list_inspirations(request_for(31, "super_admin")))
        self.assertFalse(ordinary["can_moderate"])
        self.assertTrue(admin["can_moderate"])
        self.assertTrue(super_admin["can_moderate"])

    def test_admin_and_super_admin_can_delete_another_users_item(self):
        for role in ("admin", "super_admin"):
            with self.subTest(role=role):
                self.reset_store()
                with (
                    patch.object(main, "INSPIRATION_STORE_PATH", str(self.store_path)),
                    patch.object(main, "audit_admin_change") as audit,
                ):
                    result = asyncio.run(main.delete_inspiration("shared-item", request_for(21, role)))
                self.assertTrue(result["ok"])
                self.assertTrue(result["moderated"])
                self.assertEqual(self.stored_items(), [])
                audit.assert_called_once()

    def test_ordinary_user_cannot_delete_another_users_item(self):
        with patch.object(main, "INSPIRATION_STORE_PATH", str(self.store_path)):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(main.delete_inspiration("shared-item", request_for(12, "user")))
        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(len(self.stored_items()), 1)

    def test_owner_can_still_delete_own_item(self):
        with patch.object(main, "INSPIRATION_STORE_PATH", str(self.store_path)):
            result = asyncio.run(main.delete_inspiration("shared-item", request_for(11, "user")))
        self.assertTrue(result["ok"])
        self.assertFalse(result["moderated"])
        self.assertEqual(self.stored_items(), [])


if __name__ == "__main__":
    unittest.main()
