import unittest
import shutil
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import patch

import main


class SmartCanvasVideoEditorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.javascript = (
            Path("static/js/smart-canvas.js").read_text(encoding="utf-8")
            + "\n"
            + Path("static/js/features/smart-canvas-media-tools.js").read_text(encoding="utf-8")
        )
        cls.html = Path("static/smart-canvas.html").read_text(encoding="utf-8")
        cls.styles = Path("static/css/smart-canvas.css").read_text(encoding="utf-8")

    def test_video_nodes_have_video_only_edit_frame_delete_and_download_actions(self):
        start = self.javascript.index("if(kind === 'video'){", self.javascript.index("function smartNodeToolbarHtml"))
        end = self.javascript.index("const canEditImage", start)
        video_toolbar = self.javascript[start:end]
        self.assertIn("{key:'video-edit', icon:'square-play', label:'编辑'}", video_toolbar)
        self.assertIn("{key:'video-first-frame', icon:'skip-back', label:'首帧'", video_toolbar)
        self.assertIn("{key:'video-last-frame', icon:'skip-forward', label:'尾帧'", video_toolbar)
        self.assertIn("{key:'delete', icon:'trash-2', label:'删除'}", video_toolbar)
        self.assertIn("{key:'download', icon:'download', label:'下载'}", video_toolbar)
        for image_action in ("reverse-prompt", "crop", "outpaint", "mask", "brush", "light", "grid"):
            self.assertNotIn(f"key:'{image_action}'", video_toolbar)

    def test_bottom_editor_has_transport_split_keyframe_delete_zoom_and_compose_controls(self):
        self.assertIn('id="videoEditPanel"', self.html)
        self.assertIn('id="videoEditPlay"', self.html)
        self.assertIn('id="videoEditInHandle"', self.html)
        self.assertIn('id="videoEditOutHandle"', self.html)
        self.assertIn('id="videoEditSplit"', self.html)
        self.assertIn('id="videoEditDeleteSegment"', self.html)
        self.assertIn('id="videoEditExtractFrame"', self.html)
        self.assertIn('id="videoEditSegments"', self.html)
        self.assertIn('id="videoEditZoom"', self.html)
        self.assertIn('id="videoEditCompose"', self.html)
        self.assertIn("position:fixed; left:0; right:0; bottom:0", self.styles)

    def test_keyframe_extraction_uploads_current_frame_into_a_new_image_node(self):
        start = self.javascript.index("async function extractVideoEditKeyframe(){")
        end = self.javascript.index("\nasync function composeVideoEdit(){", start)
        extract = self.javascript[start:end]
        self.assertIn("videoEditState.currentTime", extract)
        self.assertIn("await seekVideoForFrame(videoEditSource, targetTime)", extract)
        self.assertIn("ctx.drawImage(videoEditSource", extract)
        self.assertIn("uploadFiles([new File([blob]", extract)
        self.assertIn("createImageNodeAt(point, [frameItem], {select:true, skipUndo:true})", extract)
        self.assertIn("frameNode.keyframeSourceNodeId = sourceNode.id", extract)
        self.assertNotIn("closeVideoEditor()", extract)

    def test_edit_creates_a_connected_draft_and_compose_overwrites_that_node(self):
        start = self.javascript.index("function createVideoEditDraftNode(")
        end = self.javascript.index("\nfunction cloneVideoEditSegments", start)
        draft = self.javascript[start:end]
        self.assertIn("createImageNodeAt(point, [draftItem], {select:true, skipUndo:true})", draft)
        self.assertIn("draftNode.videoEditDraft = true", draft)
        self.assertIn("connectInputNode(sourceNode.id, draftNode.id)", draft)
        self.assertIn("openVideoEditor(editNode.id", draft)
        self.assertIn("source_url:sourceItem.url", draft)

        start = self.javascript.index("async function composeVideoEdit(){")
        end = self.javascript.index("\nfunction lightingClamp", start)
        compose = self.javascript[start:end]
        self.assertIn("fetch('/api/canvas-video/trim'", compose)
        self.assertIn("segments:segments.map", compose)
        self.assertIn("draftNode.images =", compose)
        self.assertIn("source_url:data.url", compose)
        self.assertIn("video_edit_original_url:", compose)
        self.assertNotIn("createImageNodeAt", compose)
        self.assertNotIn("connectInputNode", compose)

    def test_editor_reads_the_node_primary_url_instead_of_stale_display_aliases(self):
        start = self.javascript.index("function openVideoEditor(")
        end = self.javascript.index("\nfunction setVideoEditZoom", start)
        editor = self.javascript[start:end]
        self.assertIn("const rawItem = node?.images?.[imageIndex]", editor)
        self.assertIn("const item = rawItem?.url ? {...rawItem}", editor)

    def test_ffmpeg_command_encodes_browser_compatible_mp4(self):
        command = main.video_trim_ffmpeg_command(
            "/usr/bin/ffmpeg", "/tmp/source.mov", "/tmp/output.mp4", 1.25, 4.75
        )
        self.assertEqual(command[0], "/usr/bin/ffmpeg")
        self.assertIn("3.500", command)
        self.assertIn("libx264", command)
        self.assertIn("yuv420p", command)
        self.assertIn("+faststart", command)
        self.assertEqual(command[-1], "/tmp/output.mp4")

    def test_ffmpeg_segment_command_concatenates_split_clips(self):
        command = main.video_segments_ffmpeg_command(
            "/usr/bin/ffmpeg",
            "/tmp/source.mov",
            "/tmp/output.mp4",
            [(0.1, 0.3), (0.6, 0.9)],
            has_audio=True,
        )
        filter_graph = command[command.index("-filter_complex") + 1]
        self.assertIn("trim=start=0.100:end=0.300", filter_graph)
        self.assertIn("atrim=start=0.600:end=0.900", filter_graph)
        self.assertIn("concat=n=2:v=1:a=1[outv][outa]", filter_graph)
        self.assertIn("[outv]", command)
        self.assertIn("[outa]", command)


class CanvasVideoTrimEndpointTests(unittest.IsolatedAsyncioTestCase):
    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg is required for the trim integration test")
    async def test_trim_endpoint_creates_a_new_mp4_without_touching_the_source(self):
        ffmpeg = shutil.which("ffmpeg")
        with tempfile.TemporaryDirectory(prefix="canvas-video-trim-test-") as directory:
            root = Path(directory)
            source = root / "source.mp4"
            subprocess.run(
                [
                    ffmpeg,
                    "-hide_banner",
                    "-loglevel", "error",
                    "-f", "lavfi",
                    "-i", "color=c=blue:s=320x180:r=24",
                    "-f", "lavfi",
                    "-i", "sine=frequency=440:sample_rate=44100",
                    "-t", "1",
                    "-c:v", "libx264",
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac",
                    str(source),
                ],
                check=True,
            )
            payload = main.CanvasVideoTrimRequest(
                url="/assets/test/source.mp4",
                name="source.mp4",
                start=0.05,
                end=0.8,
                segments=[
                    main.CanvasVideoSegment(start=0.05, end=0.25),
                    main.CanvasVideoSegment(start=0.55, end=0.8),
                ],
            )
            with (
                patch.object(main, "OUTPUT_OUTPUT_DIR", directory),
                patch.object(main, "content_owner_identity", return_value=(1, "test")),
                patch.object(main, "require_local_media_ownership", side_effect=lambda value, owner: value),
                patch.object(main, "output_file_from_url", return_value=str(source)),
                patch.object(
                    main,
                    "output_url_for",
                    side_effect=lambda name, category="output": f"/assets/output/{name}",
                ),
                patch.object(main, "claim_local_media_urls", return_value=1),
            ):
                result = await main.canvas_video_trim(payload, object())

            output = root / result["name"]
            self.assertTrue(output.is_file())
            self.assertGreater(output.stat().st_size, 0)
            self.assertNotEqual(output, source)
            self.assertTrue(source.is_file())
            self.assertEqual(result["kind"], "video")
            self.assertAlmostEqual(result["duration"], 0.45, places=2)
            self.assertEqual(len(result["segments"]), 2)


if __name__ == "__main__":
    unittest.main()
