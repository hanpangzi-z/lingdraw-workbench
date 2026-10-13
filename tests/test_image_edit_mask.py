import tempfile
import unittest
import os
from pathlib import Path

from fastapi import HTTPException
from PIL import Image

import main


class ImageEditMaskValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def save(self, name, mode, size, image_format="PNG"):
        path = self.root / name
        Image.new(mode, size, (255, 255, 255, 255) if "A" in mode else 255).save(path, format=image_format)
        return str(path)

    def test_accepts_matching_png_source_and_alpha_mask(self):
        source = self.save("source.png", "RGBA", (1024, 768))
        mask = self.save("mask.png", "RGBA", (1024, 768))
        self.assertEqual(main.validate_image_edit_files(source, mask)["size"], (1024, 768))

    def test_rejects_mismatched_dimensions(self):
        source = self.save("source.png", "RGBA", (1024, 768))
        mask = self.save("mask.png", "RGBA", (768, 768))
        with self.assertRaises(HTTPException) as raised:
            main.validate_image_edit_files(source, mask)
        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("尺寸一致", str(raised.exception.detail))

    def test_rejects_mask_without_alpha_channel(self):
        source = self.save("source.png", "RGBA", (512, 512))
        mask = self.save("mask.png", "L", (512, 512))
        with self.assertRaises(HTTPException) as raised:
            main.validate_image_edit_files(source, mask)
        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("Alpha", str(raised.exception.detail))

    def test_legacy_white_on_black_mask_is_converted_to_alpha(self):
        mask_path = self.root / "legacy-mask.png"
        legacy = Image.new("RGBA", (4, 4), (0, 0, 0, 255))
        legacy.putpixel((1, 2), (255, 255, 255, 255))
        legacy.save(mask_path, format="PNG")

        prepared, temporary = main.prepare_image_edit_mask(str(mask_path))
        try:
            self.assertNotEqual(prepared, str(mask_path))
            with Image.open(prepared).convert("RGBA") as mask:
                self.assertEqual(mask.getpixel((0, 0)), (0, 0, 0, 255))
                self.assertEqual(mask.getpixel((1, 2)), (255, 255, 255, 0))
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)

    def test_existing_alpha_mask_is_normalized_for_rgb_and_alpha_gateways(self):
        mask_path = self.root / "alpha-mask.png"
        mask = Image.new("RGBA", (4, 4), (0, 0, 0, 255))
        mask.putpixel((1, 2), (0, 0, 0, 0))
        mask.save(mask_path, format="PNG")

        prepared, temporary = main.prepare_image_edit_mask(str(mask_path))
        try:
            self.assertNotEqual(prepared, str(mask_path))
            with Image.open(prepared).convert("RGBA") as normalized:
                self.assertEqual(normalized.getpixel((0, 0)), (0, 0, 0, 255))
                self.assertEqual(normalized.getpixel((1, 2)), (255, 255, 255, 0))
        finally:
            if temporary and os.path.exists(temporary):
                os.unlink(temporary)

    def test_mask_is_baked_into_source_as_a_white_transparent_hole(self):
        source_path = self.root / "source.png"
        source = Image.new("RGB", (4, 4), (24, 80, 160))
        source.save(source_path, format="PNG")
        mask_path = self.root / "mask.png"
        mask = Image.new("RGBA", (4, 4), (0, 0, 0, 255))
        mask.putpixel((1, 2), (0, 0, 0, 0))
        mask.save(mask_path, format="PNG")

        prepared = main.prepare_masked_image_edit_source(str(source_path), str(mask_path))
        try:
            with Image.open(prepared).convert("RGBA") as edit_source:
                self.assertEqual(edit_source.getpixel((0, 0)), (24, 80, 160, 255))
                self.assertEqual(edit_source.getpixel((1, 2)), (255, 255, 255, 0))
        finally:
            if os.path.exists(prepared):
                os.unlink(prepared)

    def test_existing_source_transparency_is_preserved_outside_mask(self):
        source_path = self.root / "source.png"
        source = Image.new("RGBA", (3, 3), (10, 20, 30, 255))
        source.putpixel((0, 0), (10, 20, 30, 64))
        source.save(source_path, format="PNG")
        mask_path = self.root / "mask.png"
        mask = Image.new("RGBA", (3, 3), (0, 0, 0, 255))
        mask.putpixel((2, 2), (0, 0, 0, 0))
        mask.save(mask_path, format="PNG")

        prepared = main.prepare_masked_image_edit_source(str(source_path), str(mask_path))
        try:
            with Image.open(prepared).convert("RGBA") as edit_source:
                self.assertEqual(edit_source.getpixel((0, 0))[3], 64)
                self.assertEqual(edit_source.getpixel((2, 2))[3], 0)
        finally:
            if os.path.exists(prepared):
                os.unlink(prepared)

    def test_png_mask_can_edit_a_jpeg_source(self):
        source = self.root / "source.jpg"
        Image.new("RGB", (16, 12), (255, 255, 255)).save(source, format="JPEG")
        mask = self.root / "mask.png"
        Image.new("RGBA", (16, 12), (0, 0, 0, 255)).save(mask, format="PNG")

        self.assertEqual(main.validate_image_edit_files(str(source), str(mask))["size"], (16, 12))

    def test_comfly_provider_is_detected_by_host_not_display_name(self):
        self.assertTrue(main.is_comfly_image_provider({"name": "custom", "base_url": "https://ai.comfly.org/v1"}))
        self.assertFalse(main.is_comfly_image_provider({"name": "comfly", "base_url": "https://example.invalid/v1"}))

if __name__ == "__main__":
    unittest.main()
