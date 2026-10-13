import json
import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from starlette.requests import Request

import main


class InspirationPerformanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store_path = self.root / "inspirations.json"
        self.preview_dir = self.root / "previews"
        self.image_path = self.root / "source.png"
        Image.new("RGB", (1200, 1800), "red").save(self.image_path)
        self.item = {
            "id": "item-1", "category": "创意", "image_url": "/output/source.png",
            "owner_username": "designer", "created_at": 1, "width": 1200, "height": 1800,
        }
        self.store_path.write_text(json.dumps({"items": [self.item]}, ensure_ascii=False), encoding="utf-8")
        main.invalidate_inspiration_store_cache()

    def tearDown(self):
        main.invalidate_inspiration_store_cache()
        self.temp.cleanup()

    def test_store_is_cached_until_file_mtime_changes(self):
        with patch.object(main, "INSPIRATION_STORE_PATH", str(self.store_path)):
            first = main.load_inspiration_store()
            second = main.load_inspiration_store()
            self.assertIs(first, second)
            self.assertIs(main.find_inspiration_item("item-1"), first["items"][0])

    def test_list_defaults_to_24_and_returns_dimensions(self):
        items = [{**self.item, "id": f"item-{index}", "created_at": index} for index in range(30)]
        request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
        request.state.platform_account = {"id": 1, "username": "test", "role": "user"}
        with patch.object(main, "load_inspiration_store", return_value={"items": items}):
            data = asyncio.run(main.list_inspirations(request))
        self.assertEqual(len(data["items"]), 24)
        self.assertEqual(data["total"], 30)
        self.assertEqual(data["items"][0]["thumbnail_url"], "/api/inspirations/item-29/thumbnail?v=29")
        self.assertEqual((data["items"][0]["width"], data["items"][0]["height"]), (1200, 1800))

    def test_list_does_not_open_original_for_legacy_dimensions(self):
        item = {key: value for key, value in self.item.items() if key not in {"width", "height"}}
        with patch.object(main.Image, "open", side_effect=AssertionError("list opened source image")):
            public = main.public_inspiration_item(item)
        self.assertIsNone(public["width"])
        self.assertIsNone(public["height"])

    def test_thumbnail_is_webp_bounded_and_reused(self):
        with patch.object(main, "INSPIRATION_PREVIEW_DIR", str(self.preview_dir)), \
             patch.object(main, "output_file_from_url", return_value=str(self.image_path)):
            first = main.build_inspiration_thumbnail(self.item)
            first_mtime = os.stat(first).st_mtime_ns
            second = main.build_inspiration_thumbnail(self.item)
        self.assertEqual(first, second)
        self.assertEqual(first_mtime, os.stat(second).st_mtime_ns)
        with Image.open(first) as thumbnail:
            self.assertEqual(thumbnail.format, "WEBP")
            self.assertLessEqual(max(thumbnail.size), 768)

    def test_thumbnail_endpoint_uses_long_lived_cache(self):
        with patch.object(main, "INSPIRATION_PREVIEW_DIR", str(self.preview_dir)), \
             patch.object(main, "find_inspiration_item", return_value=self.item), \
             patch.object(main, "output_file_from_url", return_value=str(self.image_path)):
            response = asyncio.run(main.get_inspiration_thumbnail("item-1"))
        self.assertEqual(response.media_type, "image/webp")
        self.assertIn("max-age=31536000", response.headers["cache-control"])

    def test_remote_thumbnail_redirects_without_fetching(self):
        remote = {**self.item, "image_url": "https://cdn.example.com/image.png"}
        with patch.object(main, "find_inspiration_item", return_value=remote), \
             patch.object(main, "output_file_from_url", return_value=None), \
             patch.object(main, "build_inspiration_thumbnail", side_effect=AssertionError("remote fetched")):
            response = asyncio.run(main.get_inspiration_thumbnail("item-1"))
        self.assertEqual(response.status_code, 307)
        self.assertEqual(response.headers["location"], remote["image_url"])

    def test_delete_thumbnail_cache_only(self):
        self.preview_dir.mkdir(parents=True, exist_ok=True)
        cached = self.preview_dir / "item-1_deadbeef.webp"
        cached.write_bytes(b"preview")
        with patch.object(main, "INSPIRATION_PREVIEW_DIR", str(self.preview_dir)):
            main.delete_inspiration_thumbnails("item-1")
        self.assertFalse(cached.exists())
        self.assertTrue(self.image_path.exists())


if __name__ == "__main__":
    unittest.main()
