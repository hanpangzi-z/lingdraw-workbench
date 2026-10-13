import json
import os
import base64
import asyncio
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

import main
from platform_admin import PlatformStore
from tests.mysql_support import isolated_platform_database


class PptIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(isolated_platform_database())
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.original_store = main.PLATFORM_STORE
        main.PLATFORM_STORE = PlatformStore(root / "users.sqlite3", root / "legacy.json")
        main.PLATFORM_STORE.initialize()
        self.user = main.PLATFORM_STORE.create_user("ppt-member", "password123")
        main.PLATFORM_STORE.set_user_status(self.user["id"], "enabled")
        main.PLATFORM_STORE.adjust_credit(self.user["id"], "test", "set", 10)
        with main.PLATFORM_STORE.connect(immediate=True) as connection:
            connection.execute(
                "UPDATE platform_users SET display_name=? WHERE id=?",
                ("灵绘设计师", self.user["id"]),
            )
        self.user = main.PLATFORM_STORE.user_by_id(self.user["id"])
        self.env = patch.dict(
            os.environ,
            {
                "PPT_INTERNAL_URL": "http://127.0.0.1:37623",
                "PPT_INTERNAL_TOKEN": "ppt-test-token",
            },
            clear=False,
        )
        self.env.start()
        self.client = TestClient(main.app)
        login = self.client.post(
            "/api/auth/login",
            json={"username": "ppt-member", "password": "password123"},
        )
        self.assertEqual(login.status_code, 200)

    def tearDown(self):
        self.client.close()
        self.env.stop()
        main.PLATFORM_STORE = self.original_store
        self.temp.cleanup()

    def internal_headers(self, **overrides):
        headers = {
            "x-ppt-internal-token": "ppt-test-token",
            "x-lingdraw-user-id": str(self.user["id"]),
            "x-lingdraw-username": urllib.parse.quote(self.user["username"], safe=""),
            "x-lingdraw-display-name": urllib.parse.quote("灵绘设计师", safe=""),
            "x-lingdraw-role": "user",
        }
        headers.update(overrides)
        return headers

    def test_proxy_replaces_spoofed_identity_and_rewrites_internal_redirect(self):
        captured = {}

        class ResponseStream(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b"redirecting"

        async def upstream(request):
            captured["method"] = request.method
            captured["url"] = str(request.url)
            captured["headers"] = dict(request.headers)
            captured["body"] = await request.aread()
            return httpx.Response(
                307,
                headers={
                    "location": "http://127.0.0.1:37623/ppt/projects?from=upstream",
                    "content-type": "text/plain",
                    "set-cookie": f"{main.AUTH_COOKIE_NAME}=sidecar-controlled; Path=/",
                    "connection": "x-upstream-private",
                    "x-upstream-private": "must-not-pass",
                },
                stream=ResponseStream(),
            )

        transport = httpx.MockTransport(upstream)

        def client_factory(timeout, follow_redirects=False):
            return httpx.AsyncClient(
                transport=transport,
                timeout=timeout,
                follow_redirects=follow_redirects,
            )

        with patch.object(main, "ppt_proxy_http_client", side_effect=client_factory):
            response = self.client.post(
                "/ppt/api/echo?value=1",
                content=b"request-body",
                headers={
                    "content-type": "application/octet-stream",
                    "authorization": "Bearer browser-secret",
                    "x-ppt-internal-token": "spoofed-token",
                    "x-lingdraw-user-id": "999999",
                    "x-lingdraw-username": "attacker",
                    "x-lingdraw-display-name": "attacker",
                    "x-lingdraw-role": "super_admin",
                    "x-forwarded-for": "203.0.113.55",
                    "x-forwarded-proto": "javascript",
                    "connection": "x-browser-private",
                    "x-browser-private": "must-not-pass",
                },
                follow_redirects=False,
            )

        self.assertEqual(response.status_code, 307)
        self.assertEqual(response.headers["location"], "/ppt/projects?from=upstream")
        self.assertEqual(captured["method"], "POST")
        self.assertEqual(captured["url"], "http://127.0.0.1:37623/ppt/api/echo?value=1")
        self.assertEqual(captured["body"], b"request-body")
        self.assertEqual(captured["headers"]["x-ppt-internal-token"], "ppt-test-token")
        self.assertEqual(captured["headers"]["x-lingdraw-user-id"], str(self.user["id"]))
        self.assertEqual(captured["headers"]["x-lingdraw-username"], "ppt-member")
        self.assertEqual(
            captured["headers"]["x-lingdraw-display-name"],
            urllib.parse.quote("灵绘设计师", safe=""),
        )
        self.assertEqual(captured["headers"]["x-lingdraw-role"], "user")
        self.assertEqual(captured["headers"]["x-forwarded-for"], "testclient")
        self.assertEqual(captured["headers"]["x-forwarded-proto"], "http")
        self.assertNotIn("authorization", captured["headers"])
        self.assertNotIn("x-browser-private", captured["headers"])
        self.assertNotIn("x-upstream-private", response.headers)
        self.assertNotIn("set-cookie", response.headers)
        self.assertNotIn(main.AUTH_COOKIE_NAME, captured["headers"].get("cookie", ""))
        self.assertEqual(
            main.ppt_rewrite_location("//127.0.0.1:37623/ppt/projects"),
            "/ppt/projects",
        )

    def test_proxy_returns_styled_html_or_json_when_node_is_unavailable(self):
        async def unavailable(request):
            raise httpx.ConnectError("connection refused", request=request)

        transport = httpx.MockTransport(unavailable)

        def client_factory(timeout, follow_redirects=False):
            return httpx.AsyncClient(transport=transport, timeout=timeout)

        with patch.object(main, "ppt_proxy_http_client", side_effect=client_factory):
            browser = self.client.get(
                "/ppt/projects",
                headers={"accept": "text/html", "sec-fetch-dest": "iframe"},
            )
            api = self.client.post(
                "/ppt/api/projects",
                json={"title": "demo"},
                headers={"accept": "application/json"},
            )

        self.assertEqual(browser.status_code, 503)
        self.assertIn("PPT 服务暂时不可用", browser.text)
        self.assertIn("重新连接", browser.text)
        self.assertNotIn("127.0.0.1", browser.text)
        self.assertEqual(api.status_code, 503)
        self.assertEqual(api.json()["code"], "ppt_service_unavailable")

    def test_sidecar_auth_failure_does_not_log_out_authenticated_host(self):
        upstream_responses = []
        clients = []

        async def upstream(request):
            response = httpx.Response(
                401,
                headers={"content-type": "text/html"},
                content=main.ppt_auth_required_response(401, "login_required").body,
            )
            upstream_responses.append(response)
            return response

        def client_factory(timeout, follow_redirects=False):
            client = httpx.AsyncClient(transport=httpx.MockTransport(upstream), timeout=timeout)
            clients.append(client)
            return client

        with patch.object(main, "ppt_proxy_http_client", side_effect=client_factory):
            browser = self.client.get(
                "/ppt/projects", headers={"accept": "text/html", "sec-fetch-dest": "iframe"},
            )
            api = self.client.get("/ppt/api/projects", headers={"accept": "application/json"})
            head = self.client.head("/ppt/projects", headers={"accept": "text/html"})

        self.assertEqual(browser.status_code, 503)
        self.assertIn("PPT 服务暂时不可用", browser.text)
        self.assertNotIn("ppt:auth-required", browser.text)
        self.assertNotIn("/login", browser.text)
        self.assertEqual(browser.headers["cache-control"], "no-store")
        self.assertEqual(api.status_code, 503)
        self.assertEqual(api.json()["code"], "ppt_service_unavailable")
        self.assertEqual(head.status_code, 503)
        self.assertTrue(all(response.is_closed for response in upstream_responses))
        self.assertTrue(all(client.is_closed for client in clients))
        self.assertTrue(self.client.get("/api/auth/status").json()["authenticated"])

    def test_expired_ppt_iframe_session_notifies_host_instead_of_nesting_login(self):
        anonymous = TestClient(main.app)
        self.addCleanup(anonymous.close)
        browser = anonymous.get(
            "/ppt/projects",
            headers={"accept": "text/html", "sec-fetch-dest": "iframe"},
        )
        api = anonymous.get("/ppt/api/projects", headers={"accept": "application/json"})

        self.assertEqual(browser.status_code, 401)
        self.assertIn('"type":"ppt:auth-required"', browser.text)
        self.assertIn("window.parent.postMessage", browser.text)
        self.assertIn("window.location.origin", browser.text)
        self.assertNotIn('<iframe', browser.text)
        self.assertEqual(api.status_code, 401)
        self.assertEqual(api.json()["code"], "login_required")

        main.PLATFORM_STORE.set_user_status(self.user["id"], "disabled")
        disabled = self.client.get(
            "/ppt/projects",
            headers={"accept": "text/html", "sec-fetch-dest": "iframe"},
        )
        self.assertEqual(disabled.status_code, 403)
        self.assertIn('"code":"account_disabled"', disabled.text)
        self.assertIn("window.parent.postMessage", disabled.text)

    def test_proxy_closes_upstream_client_and_propagates_cancellation(self):
        class CancelClient:
            def __init__(self):
                self.closed = False

            def build_request(self, *args, **kwargs):
                return object()

            async def send(self, request, stream=False):
                raise asyncio.CancelledError()

            async def aclose(self):
                self.closed = True

        scope = {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/ppt/projects",
            "raw_path": b"/ppt/projects",
            "query_string": b"",
            "headers": [(b"host", b"testserver"), (b"accept", b"text/html")],
            "client": ("127.0.0.1", 12345),
            "server": ("testserver", 80),
            "root_path": "",
            "state": {},
        }
        request = Request(scope)
        main.bind_platform_account_to_request(request, self.user)
        upstream_client = CancelClient()
        with patch.object(main, "ppt_proxy_http_client", return_value=upstream_client):
            with self.assertRaises(asyncio.CancelledError):
                asyncio.run(main.ppt_reverse_proxy(request))
        self.assertTrue(upstream_client.closed)

    def test_proxy_reuses_its_internal_sidecar_connection_pool(self):
        async def scenario():
            await main.close_ppt_proxy_http_client()
            timeout = httpx.Timeout(connect=5.0, read=None, write=None, pool=5.0)
            first = main.ppt_proxy_http_client(timeout)
            second = main.ppt_proxy_http_client(timeout)
            self.assertIs(first.client, second.client)
            await first.aclose()
            self.assertFalse(second.client.is_closed)
            await main.close_ppt_proxy_http_client()
            self.assertTrue(second.client.is_closed)

        asyncio.run(scenario())

    def test_external_image_download_pins_dns_and_does_not_reresolve(self):
        resolver_calls = []

        def rebinding_resolver(host, port, *args):
            resolver_calls.append((host, port))
            address = "93.184.216.34" if len(resolver_calls) == 1 else "127.0.0.1"
            return [(main.socket.AF_INET, main.socket.SOCK_STREAM, 6, "", (address, port))]

        captured = {}

        async def upstream(request):
            captured["url"] = str(request.url)
            captured["host"] = request.headers.get("host")
            captured["sni"] = request.extensions.get("sni_hostname")
            return httpx.Response(
                200,
                headers={"content-type": "image/png"},
                content=b"\x89PNG\r\n\x1a\nimage-data",
            )

        transport = httpx.MockTransport(upstream)

        def client_factory(timeout, follow_redirects=False):
            return httpx.AsyncClient(transport=transport, timeout=timeout, follow_redirects=False)

        provider = {"id": "test-image-provider", "base_url": "https://rebind.example/v1"}
        with (
            patch.object(main.socket, "getaddrinfo", side_effect=rebinding_resolver),
            patch.object(main, "get_api_provider_exact", return_value=provider),
            patch.object(main, "remote_media_request_headers", return_value={"Accept": "image/*"}),
            patch.object(main, "ppt_http_client", side_effect=client_factory),
        ):
            content, mime = asyncio.run(main.ppt_fetch_external_image(
                "https://rebind.example/generated.png", provider["id"], "test-image-model",
            ))

        self.assertEqual(content, b"\x89PNG\r\n\x1a\nimage-data")
        self.assertEqual(mime, "image/png")
        self.assertEqual(resolver_calls, [("rebind.example", 443)])
        self.assertEqual(captured["url"], "https://93.184.216.34/generated.png")
        self.assertEqual(captured["host"], "rebind.example")
        self.assertIn(captured["sni"], {"rebind.example", b"rebind.example"})

    def test_external_image_download_allows_https_tun_fake_ip_for_hostname(self):
        def fake_ip_resolver(host, port, *args):
            self.assertEqual(host, "provider-images.example")
            return [(
                main.socket.AF_INET,
                main.socket.SOCK_STREAM,
                6,
                "",
                ("198.18.0.130", port),
            )]

        captured = {}

        async def upstream(request):
            captured["url"] = str(request.url)
            captured["host"] = request.headers.get("host")
            captured["sni"] = request.extensions.get("sni_hostname")
            return httpx.Response(
                200,
                headers={"content-type": "image/png"},
                content=b"\x89PNG\r\n\x1a\nfake-ip-image",
            )

        transport = httpx.MockTransport(upstream)

        def client_factory(timeout, follow_redirects=False):
            return httpx.AsyncClient(transport=transport, timeout=timeout, follow_redirects=False)

        provider = {"id": "test-image-provider", "base_url": "https://provider-images.example/v1"}
        with (
            patch.object(main.socket, "getaddrinfo", side_effect=fake_ip_resolver),
            patch.object(main, "get_api_provider_exact", return_value=provider),
            patch.object(main, "remote_media_request_headers", return_value={"Accept": "image/*"}),
            patch.object(main, "ppt_http_client", side_effect=client_factory),
        ):
            content, mime = asyncio.run(main.ppt_fetch_external_image(
                "https://provider-images.example/generated.png", provider["id"], "gpt-image-2",
            ))

        self.assertEqual(content, b"\x89PNG\r\n\x1a\nfake-ip-image")
        self.assertEqual(mime, "image/png")
        self.assertEqual(captured["url"], "https://198.18.0.130/generated.png")
        self.assertEqual(captured["host"], "provider-images.example")
        self.assertIn(captured["sni"], {"provider-images.example", b"provider-images.example"})

    def test_external_image_download_rejects_literal_tun_fake_ip(self):
        with self.assertRaises(HTTPException) as error:
            asyncio.run(main.ppt_pinned_external_url("https://198.18.0.130/generated.png"))
        self.assertIn("内部网络", str(error.exception.detail))

    def test_external_image_redirect_revalidates_origin_and_drops_provider_keys(self):
        captured = []
        addresses = {
            "provider-images.example": "93.184.216.34",
            "public-cdn.example": "93.184.216.35",
        }

        def resolver(host, port, *args):
            return [(
                main.socket.AF_INET,
                main.socket.SOCK_STREAM,
                6,
                "",
                (addresses[host], port),
            )]

        async def upstream(request):
            captured.append({"url": str(request.url), "headers": dict(request.headers)})
            if request.url.host == "93.184.216.34":
                return httpx.Response(
                    302,
                    headers={"location": "https://public-cdn.example/final.png"},
                )
            return httpx.Response(
                200,
                headers={"content-type": "image/png"},
                content=b"\x89PNG\r\n\x1a\nredirected-image",
            )

        transport = httpx.MockTransport(upstream)

        def client_factory(timeout, follow_redirects=False):
            return httpx.AsyncClient(transport=transport, timeout=timeout, follow_redirects=False)

        provider = {"id": "test-image-provider", "base_url": "https://provider-images.example/v1"}
        credential_headers = {
            "Authorization": "Bearer provider-secret",
            "x-api-key": "api-secret",
            "x-goog-api-key": "google-secret",
            "Accept": "image/*",
        }
        with (
            patch.object(main.socket, "getaddrinfo", side_effect=resolver),
            patch.object(main, "get_api_provider_exact", return_value=provider),
            patch.object(main, "remote_media_request_headers", return_value=credential_headers),
            patch.object(main, "ppt_http_client", side_effect=client_factory),
        ):
            content, mime = asyncio.run(main.ppt_fetch_external_image(
                "https://provider-images.example/start.png", provider["id"], "test-image-model",
            ))

        self.assertEqual(mime, "image/png")
        self.assertTrue(content.endswith(b"redirected-image"))
        self.assertEqual(len(captured), 2)
        self.assertEqual(captured[0]["headers"]["authorization"], "Bearer provider-secret")
        for key in ("authorization", "x-api-key", "x-goog-api-key"):
            self.assertNotIn(key, captured[1]["headers"])
        self.assertEqual(captured[0]["headers"]["host"], "provider-images.example")
        self.assertEqual(captured[1]["headers"]["host"], "public-cdn.example")

    def test_external_image_rejects_non_image_and_oversized_response(self):
        def resolver(host, port, *args):
            return [(main.socket.AF_INET, main.socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]

        responses = [
            httpx.Response(200, headers={"content-type": "text/html"}, content=b"<html>not an image</html>"),
            httpx.Response(
                200,
                headers={
                    "content-type": "image/png",
                    "content-length": str(main.PPT_IMAGE_OUTPUT_MAX_BYTES + 1),
                },
                content=b"",
            ),
        ]

        async def upstream(request):
            return responses.pop(0)

        transport = httpx.MockTransport(upstream)

        def client_factory(timeout, follow_redirects=False):
            return httpx.AsyncClient(transport=transport, timeout=timeout, follow_redirects=False)

        with (
            patch.object(main.socket, "getaddrinfo", side_effect=resolver),
            patch.object(main, "remote_media_request_headers", return_value={"Accept": "image/*"}),
            patch.object(main, "ppt_http_client", side_effect=client_factory),
        ):
            with self.assertRaises(HTTPException) as type_error:
                asyncio.run(main.ppt_fetch_external_image(
                    "https://public.example/not-image", "", "",
                ))
            with self.assertRaises(HTTPException) as size_error:
                asyncio.run(main.ppt_fetch_external_image(
                    "https://public.example/too-large.png", "", "",
                ))
        self.assertIn("没有返回图片", str(type_error.exception.detail))
        self.assertIn("50MB", str(size_error.exception.detail))

    def test_image_bridge_output_mime_contract_matches_the_ppt_decoder(self):
        self.assertEqual(
            main.PPT_IMAGE_OUTPUT_ALLOWED_MIMES,
            {"image/png", "image/jpeg", "image/webp", "image/gif"},
        )
        self.assertEqual(
            main.ppt_verified_image_mime(b"GIF89asupported", "image/gif"),
            "image/gif",
        )

    def test_image_output_loopback_is_rejected_and_refunded(self):
        provider = {"id": "test-image-provider", "image_models": ["gpt-image-2-test"]}
        generated = {"type": "url", "value": "http://127.0.0.1/private.png"}
        files = {"images": ("reference.png", b"\x89PNG\r\n\x1a\nreference", "image/png")}
        with (
            patch.object(main, "ppt_image_target", return_value=(provider, "gpt-image-2-test")),
            patch.object(main, "generate_ai_image", new=AsyncMock(return_value=(generated, {}))),
        ):
            response = self.client.post(
                "/api/ppt/internal/ai/image",
                data={"prompt": "product scene", "request_id": "ppt-loopback-output"},
                files=files,
                headers=self.internal_headers(),
            )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.headers.get("x-refunded-points"), "1")
        self.assertIn("内部网络", response.json()["detail"])
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user["id"])["balance"], 10)

    def test_ppt_image_provider_and_model_must_be_selected_explicitly(self):
        providers = [
            {
                "id": "modelscope",
                "name": "ModelScope",
                "enabled": True,
                "primary": False,
                "protocol": "openai",
                "image_models": ["Tongyi-MAI/Z-Image-Turbo"],
            },
            {
                "id": "custom-api",
                "name": "comfly",
                "enabled": True,
                "primary": False,
                "protocol": "openai",
                "image_models": ["gpt-image-2"],
            },
        ]
        with (
            patch.object(main, "load_api_providers", return_value=providers),
            patch.object(main, "provider_env_key_value", side_effect=lambda provider_id: "configured" if provider_id == "custom-api" else ""),
        ):
            with self.assertRaises(HTTPException) as missing_selection:
                main.ppt_image_target()
            with self.assertRaises(HTTPException) as missing_model:
                main.ppt_image_target("custom-api")
            with self.assertRaises(HTTPException) as unavailable_provider:
                main.ppt_image_target("modelscope", "Tongyi-MAI/Z-Image-Turbo")
            with self.assertRaises(HTTPException) as mismatched_model:
                main.ppt_image_target("custom-api", "unknown-model")
            provider, model = main.ppt_image_target("custom-api", "gpt-image-2")

        self.assertEqual(missing_selection.exception.status_code, 400)
        self.assertIn("请选择", str(missing_selection.exception.detail))
        self.assertEqual(missing_model.exception.status_code, 400)
        self.assertIn("不可用", str(unavailable_provider.exception.detail))
        self.assertIn("不属于", str(mismatched_model.exception.detail))
        self.assertEqual((provider["id"], model), ("custom-api", "gpt-image-2"))

    def test_missing_ppt_image_model_is_rejected_before_reserving_points(self):
        request_id = "ppt-missing-model"
        response = self.client.post(
            "/api/ppt/internal/ai/image",
            data={"prompt": "product scene", "request_id": request_id},
            files={"images": ("reference.png", b"\x89PNG\r\n\x1a\nreference", "image/png")},
            headers=self.internal_headers(),
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("请选择", response.json()["detail"])
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user["id"])["balance"], 10)
        self.assertIsNone(main.PLATFORM_STORE.usage_by_idempotency_key(
            main.api_usage_idempotency_key(self.user["username"], "ppt-ai-image", request_id)
        ))

    def test_cancelled_image_generation_releases_the_reservation(self):
        provider = {"id": "test-image-provider", "image_models": ["gpt-image-2-test"]}
        files = {"images": ("reference.png", b"\x89PNG\r\n\x1a\nreference", "image/png")}
        with (
            patch.object(main, "ppt_image_target", return_value=(provider, "gpt-image-2-test")),
            patch.object(main, "generate_ai_image", new=AsyncMock(side_effect=asyncio.CancelledError())),
            # Starlette's BaseHTTPMiddleware may surface route cancellation as
            # either CancelledError or its "No response returned" wrapper.
            self.assertRaises((asyncio.CancelledError, RuntimeError)),
        ):
            self.client.post(
                "/api/ppt/internal/ai/image",
                data={"prompt": "product scene", "request_id": "ppt-cancelled-image"},
                files=files,
                headers=self.internal_headers(),
            )
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user["id"])["balance"], 10)
        event = main.PLATFORM_STORE.usage_by_idempotency_key(
            main.api_usage_idempotency_key(self.user["username"], "ppt-ai-image", "ppt-cancelled-image")
        )
        self.assertEqual(event["status"], "failed")

    def test_health_is_public_degraded_and_does_not_leak_diagnostics(self):
        async def unhealthy(request):
            return httpx.Response(
                503,
                json={
                    "ok": False,
                    "checks": {
                        "service": {"ok": True, "status": "ready"},
                        "database": {"ok": False, "status": "down", "dsn": "postgres://secret"},
                        "storage": {"ok": True, "status": "ok", "path": "D:/secret"},
                    },
                },
            )

        transport = httpx.MockTransport(unhealthy)

        def client_factory(timeout, follow_redirects=False):
            return httpx.AsyncClient(transport=transport, timeout=timeout)

        anonymous = TestClient(main.app)
        self.addCleanup(anonymous.close)
        with patch.object(main, "ppt_http_client", side_effect=client_factory):
            response = anonymous.get("/api/ppt/health")

        self.assertEqual(response.status_code, 503)
        payload = response.json()
        self.assertEqual(payload["status"], "degraded")
        self.assertTrue(payload["node"]["ok"])
        self.assertFalse(payload["database"]["ok"])
        self.assertTrue(payload["storage"]["ok"])
        self.assertNotIn("secret", json.dumps(payload))
        self.assertNotIn("path", json.dumps(payload))
        self.assertEqual(set(payload["database"]), {"ok", "status"})

    def test_internal_ai_auth_runs_before_body_validation_and_binds_canonical_user(self):
        missing = self.client.post(
            "/api/ppt/internal/ai/chat",
            content=b"not-json",
            headers={"content-type": "application/json"},
        )
        wrong_token = self.client.post(
            "/api/ppt/internal/ai/chat",
            content=b"not-json",
            headers={"content-type": "application/json", "x-ppt-internal-token": "wrong"},
        )
        wrong_user = self.client.post(
            "/api/ppt/internal/ai/chat",
            json={"user_prompt": "test"},
            headers=self.internal_headers(**{"x-lingdraw-user-id": "99999"}),
        )

        self.assertEqual(missing.status_code, 401)
        self.assertEqual(missing.json()["code"], "ppt_internal_unauthorized")
        self.assertEqual(wrong_token.status_code, 401)
        self.assertEqual(wrong_token.json()["code"], "ppt_internal_unauthorized")
        self.assertEqual(wrong_user.status_code, 401)
        self.assertEqual(wrong_user.json()["code"], "ppt_internal_identity_invalid")

    def test_empty_internal_token_fails_closed_and_disabled_user_is_rejected(self):
        with patch.dict(os.environ, {"PPT_INTERNAL_TOKEN": ""}, clear=False):
            proxy = self.client.get("/ppt/projects", headers={"accept": "text/html"})
            internal = self.client.post(
                "/api/ppt/internal/ai/chat",
                content=b"not-json",
                headers={"content-type": "application/json"},
            )
        self.assertEqual(proxy.status_code, 503)
        self.assertEqual(internal.status_code, 503)
        self.assertEqual(internal.json()["code"], "ppt_internal_not_configured")

        main.PLATFORM_STORE.set_user_status(self.user["id"], "disabled")
        browser = self.client.get("/ppt/api/projects", headers={"accept": "application/json"})
        internal = self.client.post(
            "/api/ppt/internal/ai/chat",
            json={"user_prompt": "test"},
            headers=self.internal_headers(),
        )
        self.assertEqual(browser.status_code, 403)
        self.assertEqual(browser.json()["code"], "account_disabled")
        self.assertEqual(internal.status_code, 403)
        self.assertEqual(internal.json()["code"], "account_disabled")

    def test_chat_bridge_charges_success_and_refunds_failure(self):
        provider = {"id": "test-provider", "chat_models": ["test-chat-model"]}
        body = {
            "operation": "field-detection",
            "system_prompt": "Return structured data.",
            "user_prompt": "Map these fields.",
            "response_schema": {
                "type": "object",
                "additionalProperties": False,
                "properties": {"mappings": {"type": "array"}},
                "required": ["mappings"],
            },
            "request_id": "ppt-chat-success",
        }
        with (
            patch.object(main, "ppt_chat_target", return_value=(provider, "test-chat-model")),
            patch.object(
                main,
                "ppt_execute_chat",
                new=AsyncMock(return_value={
                    "text": '{"mappings":[]}',
                    "model": "test-chat-model",
                    "raw_usage": {"total_tokens": 12},
                }),
            ),
        ):
            succeeded = self.client.post(
                "/api/ppt/internal/ai/chat",
                json=body,
                headers=self.internal_headers(),
            )

        self.assertEqual(succeeded.status_code, 200)
        self.assertEqual(succeeded.json()["data"], {"mappings": []})
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user["id"])["balance"], 9)

        with (
            patch.object(main, "ppt_chat_target", return_value=(provider, "test-chat-model")),
            patch.object(main, "ppt_execute_chat", new=AsyncMock()) as duplicate_upstream,
        ):
            duplicate = self.client.post(
                "/api/ppt/internal/ai/chat",
                json=body,
                headers=self.internal_headers(),
            )
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(duplicate.json()["detail"]["code"], "ppt_ai_request_already_processed")
        duplicate_upstream.assert_not_awaited()
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user["id"])["balance"], 9)

        body["request_id"] = "ppt-chat-schema-failure"
        with (
            patch.object(main, "ppt_chat_target", return_value=(provider, "test-chat-model")),
            patch.object(
                main,
                "ppt_execute_chat",
                new=AsyncMock(return_value={"text": '{"wrong":[]}', "model": "test-chat-model"}),
            ),
        ):
            schema_failed = self.client.post(
                "/api/ppt/internal/ai/chat",
                json=body,
                headers=self.internal_headers(),
            )
        self.assertEqual(schema_failed.status_code, 502)
        self.assertEqual(schema_failed.headers.get("x-refunded-points"), "1")
        self.assertIn("Schema", schema_failed.json()["detail"])
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user["id"])["balance"], 9)

        body["request_id"] = "ppt-chat-failure"
        with (
            patch.object(main, "ppt_chat_target", return_value=(provider, "test-chat-model")),
            patch.object(
                main,
                "ppt_execute_chat",
                new=AsyncMock(side_effect=HTTPException(status_code=502, detail="upstream failed")),
            ),
        ):
            failed = self.client.post(
                "/api/ppt/internal/ai/chat",
                json=body,
                headers=self.internal_headers(),
            )

        self.assertEqual(failed.status_code, 502)
        self.assertEqual(failed.headers.get("x-refunded-points"), "1")
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user["id"])["balance"], 9)
        with main.PLATFORM_STORE.connect() as connection:
            rows = connection.execute(
                "SELECT category, operation, status, charged_points, refunded_points "
                "FROM platform_usage_events WHERE operation='ppt-ai-chat'"
            ).fetchall()
        self.assertCountEqual(
            [tuple(row[key] for key in ('category', 'operation', 'status', 'charged_points', 'refunded_points')) for row in rows],
            [
                ("chat", "ppt-ai-chat", "succeeded", 1, 0),
                ("chat", "ppt-ai-chat", "failed", 0, 1),
                ("chat", "ppt-ai-chat", "failed", 0, 1),
            ],
        )

    def test_image_bridge_uses_two_phase_owner_bound_idempotent_settlement(self):
        provider = {"id": "test-image-provider", "image_models": ["gpt-image-2-test"]}
        generated = {
            "type": "b64",
            "value": base64.b64encode(b"\x89PNG\r\n\x1a\nimage-data").decode("ascii"),
            "mime_type": "image/png",
        }
        files = {"images": ("reference.png", b"\x89PNG\r\n\x1a\nreference", "image/png")}
        with (
            patch.object(main, "ppt_image_target", return_value=(provider, "gpt-image-2-test")),
            patch.object(
                main,
                "generate_ai_image",
                new=AsyncMock(return_value=(generated, {"revised_prompt": "clean prompt"})),
            ) as upstream,
        ):
            succeeded = self.client.post(
                "/api/ppt/internal/ai/image",
                data={"prompt": "product scene", "aspectRatio": "1.5", "request_id": "ppt-image-success"},
                files=files,
                headers=self.internal_headers(),
            )

        self.assertEqual(succeeded.status_code, 200)
        self.assertEqual(succeeded.json()["image"]["mimeType"], "image/png")
        self.assertEqual(succeeded.json()["outputSize"], "1536x1024")
        self.assertEqual(succeeded.json()["revisedPrompt"], "clean prompt")
        self.assertEqual(succeeded.json()["billingStatus"], "reserved")
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user["id"])["balance"], 9)
        self.assertEqual(upstream.await_args.kwargs["request_id"], "ppt-image-success")
        self.assertTrue(upstream.await_args.kwargs["usage_event_id"])
        event = main.PLATFORM_STORE.usage_by_idempotency_key(
            main.api_usage_idempotency_key(self.user["username"], "ppt-ai-image", "ppt-image-success"),
        )
        self.assertEqual(event["status"], "reserved")

        settled = self.client.post(
            "/api/ppt/internal/ai/image/settle",
            json={"requestId": "ppt-image-success", "success": True},
            headers=self.internal_headers(),
        )
        repeated = self.client.post(
            "/api/ppt/internal/ai/image/settle",
            json={"requestId": "ppt-image-success", "success": True},
            headers=self.internal_headers(),
        )
        conflicting = self.client.post(
            "/api/ppt/internal/ai/image/settle",
            json={"requestId": "ppt-image-success", "success": False, "error": "late failure"},
            headers=self.internal_headers(),
        )
        self.assertEqual(settled.status_code, 200)
        self.assertEqual(settled.json()["status"], "succeeded")
        self.assertEqual(settled.json()["chargedPoints"], 1)
        self.assertFalse(settled.json()["idempotent"])
        self.assertEqual(repeated.status_code, 200)
        self.assertTrue(repeated.json()["idempotent"])
        self.assertEqual(conflicting.status_code, 409)
        self.assertEqual(conflicting.json()["code"], "ppt_ai_image_already_settled")

        other = main.PLATFORM_STORE.create_user("other-ppt-member", "password123")
        main.PLATFORM_STORE.set_user_status(other["id"], "enabled")
        other_headers = self.internal_headers(**{
            "x-lingdraw-user-id": str(other["id"]),
            "x-lingdraw-username": urllib.parse.quote(other["username"], safe=""),
        })
        wrong_owner = self.client.post(
            "/api/ppt/internal/ai/image/settle",
            json={"requestId": "ppt-image-success", "success": True},
            headers=other_headers,
        )
        self.assertEqual(wrong_owner.status_code, 404)
        self.assertEqual(wrong_owner.json()["code"], "ppt_ai_image_usage_not_found")

        with (
            patch.object(main, "ppt_image_target", return_value=(provider, "gpt-image-2-test")),
            patch.object(
                main,
                "generate_ai_image",
                new=AsyncMock(return_value=(generated, {"revised_prompt": "clean prompt"})),
            ),
        ):
            persisted_failed = self.client.post(
                "/api/ppt/internal/ai/image",
                data={"prompt": "product scene", "request_id": "ppt-image-persist-failure"},
                files=files,
                headers=self.internal_headers(),
            )
        self.assertEqual(persisted_failed.status_code, 200)
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user["id"])["balance"], 8)
        refunded = self.client.post(
            "/api/ppt/internal/ai/image/settle",
            json={
                "requestId": "ppt-image-persist-failure",
                "success": False,
                "error": "asset transaction rolled back",
            },
            headers=self.internal_headers(),
        )
        refunded_again = self.client.post(
            "/api/ppt/internal/ai/image/settle",
            json={"requestId": "ppt-image-persist-failure", "success": False},
            headers=self.internal_headers(),
        )
        self.assertEqual(refunded.status_code, 200)
        self.assertEqual(refunded.json()["status"], "failed")
        self.assertEqual(refunded.json()["refundedPoints"], 1)
        self.assertEqual(refunded_again.status_code, 200)
        self.assertTrue(refunded_again.json()["idempotent"])
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user["id"])["balance"], 9)

        with (
            patch.object(main, "ppt_image_target", return_value=(provider, "gpt-image-2-test")),
            patch.object(
                main,
                "generate_ai_image",
                new=AsyncMock(side_effect=HTTPException(status_code=502, detail="image provider failed")),
            ),
        ):
            failed = self.client.post(
                "/api/ppt/internal/ai/image",
                data={"prompt": "product scene", "aspectRatio": "1.5", "request_id": "ppt-image-failure"},
                files=files,
                headers=self.internal_headers(),
            )

        self.assertEqual(failed.status_code, 502)
        self.assertEqual(failed.headers.get("x-refunded-points"), "1")
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user["id"])["balance"], 9)

    def test_explicit_failed_task_id_refunds_but_unknown_outcome_remains_reserved(self):
        failed_event, _ = main.ppt_reserve_usage(
            self.user["username"], "image", "ppt-ai-image", "test-image", "terminal-task",
        )
        explicit_failure = HTTPException(status_code=502, detail="provider reported failed")
        explicit_failure.upstream_task_id = "provider-task-1"
        settled = main.ppt_refund_usage(failed_event, explicit_failure)
        self.assertEqual(settled["status"], "failed")
        self.assertEqual(settled["refunded_points"], 1)
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user["id"])["balance"], 10)

        unknown_event, _ = main.ppt_reserve_usage(
            self.user["username"], "image", "ppt-ai-image", "test-image", "unknown-task",
        )
        unknown = HTTPException(
            status_code=502,
            detail={"upstream_outcome": "unknown", "message": "poll result unavailable"},
        )
        unknown.upstream_task_id = "provider-task-2"
        self.assertIsNone(main.ppt_refund_usage(unknown_event, unknown))
        with main.PLATFORM_STORE.connect() as connection:
            row = connection.execute(
                "SELECT status FROM platform_usage_events WHERE id=?", (unknown_event,),
            ).fetchone()
        self.assertEqual(row["status"], "reserved")
        self.assertEqual(main.PLATFORM_STORE.user_balance(self.user["id"])["balance"], 9)


if __name__ == "__main__":
    unittest.main()
