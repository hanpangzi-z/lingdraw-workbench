import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

import main
from platform_admin import PlatformStore


class UserContentIsolationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.original_store = main.PLATFORM_STORE
        self.original_paths = {
            name: getattr(main, name)
            for name in (
                "DATA_DIR",
                "USER_CONTENT_DIR",
                "CANVAS_DIR",
                "PROJECTS_PATH",
                "RESOURCE_OWNERSHIP_FILE",
                "HISTORY_FILE",
                "ASSETS_DIR",
                "OUTPUT_DIR",
                "OUTPUT_INPUT_DIR",
                "OUTPUT_OUTPUT_DIR",
                "ASSET_LIBRARY_DIR",
                "LOCAL_UPLOAD_DIR",
                "ASSET_LIBRARY_PATH",
                "PROMPT_LIBRARY_PATH",
            )
        }

        data_dir = self.root / "data"
        assets_dir = self.root / "assets"
        output_dir = self.root / "output"
        replacements = {
            "DATA_DIR": str(data_dir),
            "USER_CONTENT_DIR": str(data_dir / "user_content"),
            "CANVAS_DIR": str(data_dir / "canvases"),
            "PROJECTS_PATH": str(data_dir / "projects.json"),
            "RESOURCE_OWNERSHIP_FILE": str(data_dir / "resource_ownership.json"),
            "HISTORY_FILE": str(self.root / "history.json"),
            "ASSETS_DIR": str(assets_dir),
            "OUTPUT_DIR": str(output_dir),
            "OUTPUT_INPUT_DIR": str(assets_dir / "input"),
            "OUTPUT_OUTPUT_DIR": str(assets_dir / "output"),
            "ASSET_LIBRARY_DIR": str(assets_dir / "library"),
            "LOCAL_UPLOAD_DIR": str(assets_dir / "uploads"),
            "ASSET_LIBRARY_PATH": str(data_dir / "asset_library.json"),
            "PROMPT_LIBRARY_PATH": str(data_dir / "prompt_libraries.json"),
        }
        for name, value in replacements.items():
            setattr(main, name, value)
        for folder in (
            data_dir,
            Path(main.USER_CONTENT_DIR),
            Path(main.CANVAS_DIR),
            assets_dir,
            Path(main.OUTPUT_OUTPUT_DIR),
            output_dir,
        ):
            folder.mkdir(parents=True, exist_ok=True)

        self.original_static_mounts = []
        for route in main.app.routes:
            route_name = getattr(route, "name", "")
            static_app = getattr(route, "app", None)
            if route_name not in {"assets", "output"} or static_app is None:
                continue
            self.original_static_mounts.append(
                (
                    static_app,
                    static_app.directory,
                    list(static_app.all_directories),
                )
            )
            target = main.ASSETS_DIR if route_name == "assets" else main.OUTPUT_DIR
            static_app.directory = target
            static_app.all_directories = [target]

        main.PLATFORM_STORE = PlatformStore(
            data_dir / "users.sqlite3",
            data_dir / "platform_auth.json",
        )
        main.PLATFORM_STORE.initialize()
        self.user_one = main.PLATFORM_STORE.create_user("member-one", "password123")
        self.user_two = main.PLATFORM_STORE.create_user("member-two", "password123")
        main.PLATFORM_STORE.set_user_status(self.user_one["id"], "enabled")
        main.PLATFORM_STORE.set_user_status(self.user_two["id"], "enabled")

        self.client_one = TestClient(main.app)
        self.client_two = TestClient(main.app)
        self.assertEqual(
            self.client_one.post(
                "/api/auth/login",
                json={"username": "member-one", "password": "password123"},
            ).status_code,
            200,
        )
        self.assertEqual(
            self.client_two.post(
                "/api/auth/login",
                json={"username": "member-two", "password": "password123"},
            ).status_code,
            200,
        )

    def tearDown(self):
        self.client_one.close()
        self.client_two.close()
        main.PLATFORM_STORE = self.original_store
        for name, value in self.original_paths.items():
            setattr(main, name, value)
        for static_app, directory, all_directories in self.original_static_mounts:
            static_app.directory = directory
            static_app.all_directories = all_directories
        self.temp.cleanup()

    def test_canvas_and_project_ids_cannot_cross_accounts(self):
        created_project = self.client_one.post(
            "/api/projects",
            json={"name": "member-one-project"},
        )
        self.assertEqual(created_project.status_code, 200)
        project_id = created_project.json()["project"]["id"]

        created_canvas = self.client_one.post(
            "/api/canvases",
            json={
                "title": "member-one-canvas",
                "kind": "classic",
                "project": project_id,
            },
        )
        self.assertEqual(created_canvas.status_code, 200)
        canvas_id = created_canvas.json()["canvas"]["id"]

        other_canvases = self.client_two.get("/api/canvases")
        self.assertEqual(other_canvases.status_code, 200)
        self.assertNotIn(
            canvas_id,
            {item["id"] for item in other_canvases.json()["canvases"]},
        )
        self.assertEqual(
            self.client_two.get(f"/api/canvases/{canvas_id}").status_code,
            404,
        )
        self.assertEqual(
            self.client_two.post(
                "/api/canvases",
                json={
                    "title": "cross-project-canvas",
                    "kind": "classic",
                    "project": project_id,
                },
            ).status_code,
            404,
        )

    def test_prompt_library_is_private_per_account(self):
        created = self.client_one.post(
            "/api/prompt-libraries",
            json={"name": "member-one-private-prompts"},
        )
        self.assertEqual(created.status_code, 200)
        library_id = created.json()["prompt_library"]["id"]
        added = self.client_one.post(
            "/api/prompt-libraries/items",
            json={
                "library_id": library_id,
                "name": "private-item",
                "positive": "member-one secret prompt",
            },
        )
        self.assertEqual(added.status_code, 200)

        other_library = self.client_two.get("/api/prompt-libraries")
        self.assertEqual(other_library.status_code, 200)
        serialized = json.dumps(other_library.json(), ensure_ascii=False)
        self.assertNotIn("member-one-private-prompts", serialized)
        self.assertNotIn("member-one secret prompt", serialized)

    def test_asset_library_is_private_per_account(self):
        created = self.client_one.post(
            "/api/asset-library/libraries",
            json={"name": "member-one-private-assets"},
        )
        self.assertEqual(created.status_code, 200)

        own_library = self.client_one.get("/api/asset-library")
        other_library = self.client_two.get("/api/asset-library")
        self.assertEqual(own_library.status_code, 200)
        self.assertEqual(other_library.status_code, 200)
        self.assertIn(
            "member-one-private-assets",
            json.dumps(own_library.json(), ensure_ascii=False),
        )
        self.assertNotIn(
            "member-one-private-assets",
            json.dumps(other_library.json(), ensure_ascii=False),
        )

    def test_smart_document_cannot_cross_accounts(self):
        created = self.client_one.post(
            "/api/canvases",
            json={"title": "member-one-design", "kind": "smart"},
        )
        self.assertEqual(created.status_code, 200)
        canvas = created.json()["canvas"]
        canvas_id = canvas["id"]
        saved = self.client_one.put(
            f"/api/canvases/{canvas_id}/document",
            json={
                "document": main.empty_smart_canvas_document(),
                "base_updated_at": canvas["updated_at"],
            },
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(
            self.client_two.get(f"/api/canvases/{canvas_id}/document").status_code,
            404,
        )
        self.assertEqual(
            self.client_two.put(
                f"/api/canvases/{canvas_id}/document",
                json={"document": main.empty_smart_canvas_document()},
            ).status_code,
            404,
        )

    def test_smart_document_requires_an_authenticated_session(self):
        anonymous = TestClient(main.app)
        try:
            response = anonymous.put(
                "/api/canvases/not-owned/document",
                json={"document": main.empty_smart_canvas_document()},
            )
        finally:
            anonymous.close()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "login_required")

    def test_smart_agent_session_is_isolated_and_does_not_replace_nodes(self):
        created = self.client_one.post(
            "/api/canvases",
            json={"title": "member-one-agent-session", "kind": "smart"},
        )
        self.assertEqual(created.status_code, 200)
        canvas = created.json()["canvas"]
        canvas_id = canvas["id"]
        before = main.load_canvas(canvas_id, self.user_one["id"])
        before_updated_at = before["updated_at"]
        before_nodes = list(before.get("nodes") or [])
        before_connections = list(before.get("connections") or [])
        session = {
            "schema_version": 2,
            "session_id": "session-1",
            "conversation_id": "",
            "active_turn_id": "turn-1",
            "next_sequence": 2,
            "turns": [
                {
                    "id": "turn-1",
                    "sequence": 1,
                    "user_message": {
                        "id": "message-1",
                        "role": "user",
                        "content": "中秋海报",
                    },
                    "references": [],
                    "attempts": [],
                    "active_attempt_id": "",
                    "created_at": 1,
                    "updated_at": 1,
                }
            ],
            "composer": {"draft": "", "mode_hint": "auto"},
            "updated_at": 1,
        }

        saved = self.client_one.put(
            f"/api/canvases/{canvas_id}/agent-session",
            json={"agent_session": session, "base_updated_at": 0},
        )
        self.assertEqual(saved.status_code, 200)
        session_version = saved.json()["updated_at"]
        loaded = self.client_one.get(f"/api/canvases/{canvas_id}/agent-session")
        self.assertEqual(loaded.status_code, 200)
        self.assertEqual(loaded.json()["agent_session"]["session_id"], "session-1")

        after = main.load_canvas(canvas_id, self.user_one["id"])
        self.assertEqual(after["updated_at"], before_updated_at)
        self.assertEqual(after.get("nodes") or [], before_nodes)
        self.assertEqual(after.get("connections") or [], before_connections)
        self.assertEqual(
            self.client_two.get(f"/api/canvases/{canvas_id}/agent-session").status_code,
            404,
        )
        self.assertEqual(
            self.client_two.put(
                f"/api/canvases/{canvas_id}/agent-session",
                json={"agent_session": session, "base_updated_at": session_version},
            ).status_code,
            404,
        )

        session["updated_at"] = 2
        stale = self.client_one.put(
            f"/api/canvases/{canvas_id}/agent-session",
            json={
                "agent_session": session,
                "base_updated_at": max(1, session_version - 1),
            },
        )
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["detail"]["agent_session"]["session_id"], "session-1")

    def test_smart_agent_session_requires_an_authenticated_session(self):
        anonymous = TestClient(main.app)
        session = {
            "schema_version": 2,
            "session_id": "anonymous-session",
            "conversation_id": "",
            "active_turn_id": None,
            "next_sequence": 1,
            "turns": [],
            "composer": {},
            "updated_at": 1,
        }
        try:
            response = anonymous.put(
                "/api/canvases/not-owned/agent-session",
                json={"agent_session": session},
            )
        finally:
            anonymous.close()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["code"], "login_required")

    def test_legacy_session_cookie_is_migrated_to_scoped_cookie(self):
        legacy_client = TestClient(main.app)
        try:
            legacy_token = self.client_one.cookies.get(main.AUTH_COOKIE_NAME)
            self.assertTrue(legacy_token)
            legacy_client.cookies.set(main.LEGACY_AUTH_COOKIE_NAME, legacy_token)

            response = legacy_client.get("/api/canvases")

            self.assertEqual(response.status_code, 200)
            self.assertTrue(legacy_client.cookies.get(main.AUTH_COOKIE_NAME))
            set_cookie_headers = response.headers.get_list("set-cookie")
            self.assertTrue(
                any(header.startswith(f"{main.AUTH_COOKIE_NAME}=") for header in set_cookie_headers)
            )
            self.assertTrue(
                any(
                    header.startswith(f"{main.LEGACY_AUTH_COOKIE_NAME}=")
                    and "Max-Age=0" in header
                    for header in set_cookie_headers
                )
            )
        finally:
            legacy_client.close()

    def test_history_and_local_media_urls_are_owner_scoped(self):
        media_path = Path(main.OUTPUT_OUTPUT_DIR) / "member-one-secret.png"
        media_path.write_bytes(b"private-image")
        media_url = "/assets/output/member-one-secret.png"
        main.claim_local_media_urls(media_url, self.user_one["id"])
        main.save_to_history(
            {
                "timestamp": 100,
                "type": "online",
                "images": [media_url],
            },
            self.user_one["id"],
            "member-one",
        )

        own_history = self.client_one.get("/api/history")
        other_history = self.client_two.get("/api/history")
        self.assertEqual(own_history.status_code, 200)
        self.assertEqual(other_history.status_code, 200)
        self.assertEqual(len(own_history.json()), 1)
        self.assertEqual(other_history.json(), [])

        own_download = self.client_one.get(
            "/api/download-output",
            params={"url": media_url, "inline": "true"},
        )
        self.assertEqual(own_download.status_code, 200)
        self.assertEqual(own_download.content, b"private-image")
        self.assertEqual(self.client_one.get(media_url).status_code, 200)
        self.assertEqual(
            self.client_two.get(
                "/api/download-output",
                params={"url": media_url, "inline": "true"},
            ).status_code,
            404,
        )
        self.assertEqual(self.client_two.get(media_url).status_code, 404)
        self.assertEqual(
            self.client_two.post(
                "/api/canvas-assets/check",
                json={"urls": [media_url]},
            ).json()["exists"][media_url],
            False,
        )

    def test_normal_user_cannot_import_an_unowned_server_file(self):
        unmanaged = self.root / "unmanaged.png"
        unmanaged.write_bytes(b"not-an-image")
        response = self.client_one.post(
            "/api/ai/import-local-image",
            json={"path": str(unmanaged)},
            headers={"origin": "http://testserver"},
        )
        self.assertEqual(response.status_code, 404)

    def test_temporary_account_store_cannot_claim_live_legacy_content(self):
        result = main.migrate_legacy_user_content()
        self.assertEqual(
            result,
            {"migrated": False, "reason": "account_store_mismatch"},
        )

    def test_realtime_events_do_not_cross_accounts_with_same_client_id(self):
        class FakeWebSocket:
            def __init__(self):
                self.messages = []

            async def accept(self):
                return None

            async def send_text(self, message):
                self.messages.append(json.loads(message))

        async def scenario():
            manager = main.ConnectionManager()
            first = FakeWebSocket()
            second = FakeWebSocket()
            shared_client_id = "same-browser-client-id"
            await manager.connect(first, shared_client_id, self.user_one["id"])
            await manager.connect(second, shared_client_id, self.user_two["id"])
            first.messages.clear()
            second.messages.clear()

            await manager.broadcast_new_image(
                {"images": ["/assets/output/member-one-private.png"]},
                self.user_one["id"],
            )
            await manager.broadcast_canvas_updated(
                "member-one-canvas",
                123,
                shared_client_id,
                self.user_one["id"],
            )
            await manager.broadcast_asset_library_updated(
                456,
                self.user_one["id"],
            )
            await manager.send_personal_message(
                {"type": "cloud_status", "status": "SUCCEED"},
                shared_client_id,
                self.user_one["id"],
            )
            return first.messages, second.messages

        own_messages, other_messages = asyncio.run(scenario())
        private_types = {
            "new_image",
            "canvas_updated",
            "asset_library_updated",
            "cloud_status",
        }
        self.assertEqual(
            [item["type"] for item in own_messages],
            [
                "new_image",
                "canvas_updated",
                "asset_library_updated",
                "cloud_status",
            ],
        )
        self.assertEqual(
            [item for item in other_messages if item.get("type") in private_types],
            [],
        )


if __name__ == "__main__":
    unittest.main()
