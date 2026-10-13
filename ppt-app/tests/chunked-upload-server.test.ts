import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginChunkUpload,
  completeChunkUpload,
  getChunkUpload,
  storeUploadChunk,
} from "@/src/server/assets/chunkedUpload";
import { CHUNK_UPLOAD_BYTES } from "@/src/server/assets/config";

const temporaryRoots: string[] = [];

async function useTemporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ppt-chunk-test-"));
  temporaryRoots.push(root);
  process.env.PPT_UPLOAD_TEMP_PATH = root;
  return root;
}

const checksum = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

afterEach(async () => {
  delete process.env.PPT_UPLOAD_TEMP_PATH;
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("chunked upload storage", () => {
  it("stores verified chunks, merges once, and replays a completed result", async () => {
    await useTemporaryRoot();
    const tail = new Uint8Array([7, 8, 9]);
    const first = new Uint8Array(CHUNK_UPLOAD_BYTES).fill(3);
    const session = await beginChunkUpload({
      userId: "owner-a",
      projectId: "project-a",
      fileName: "catalog.pdf",
      mimeType: "application/pdf",
      type: "source_file",
      totalSize: first.byteLength + tail.byteLength,
    });
    expect(session.chunkCount).toBe(2);

    await Promise.all([
      storeUploadChunk({ uploadId: session.uploadId, userId: "owner-a", projectId: "project-a", partNumber: 0, checksum: checksum(first), bytes: first }),
      storeUploadChunk({ uploadId: session.uploadId, userId: "owner-a", projectId: "project-a", partNumber: 1, checksum: checksum(tail), bytes: tail }),
    ]);
    const replay = await storeUploadChunk({ uploadId: session.uploadId, userId: "owner-a", projectId: "project-a", partNumber: 0, checksum: checksum(first), bytes: first });
    expect(replay.deduplicated).toBe(true);

    const persist = vi.fn(async (filePath: string, completedSession: typeof session) => {
      const bytes = new Uint8Array(await readFile(filePath));
      expect(completedSession.fileName).toBe("catalog.pdf");
      expect(bytes.byteLength).toBe(first.byteLength + tail.byteLength);
      expect(bytes[0]).toBe(3);
      expect([...bytes.slice(-3)]).toEqual([7, 8, 9]);
      return { id: "asset-a", size: bytes.byteLength };
    });
    await expect(completeChunkUpload(session.uploadId, "owner-a", "project-a", persist)).resolves.toEqual({ id: "asset-a", size: first.byteLength + tail.byteLength });
    await expect(completeChunkUpload(session.uploadId, "owner-a", "project-a", persist)).resolves.toEqual({ id: "asset-a", size: first.byteLength + tail.byteLength });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("rejects a corrupt chunk and hides another user's upload", async () => {
    await useTemporaryRoot();
    const session = await beginChunkUpload({
      userId: "owner-a",
      projectId: "project-a",
      fileName: "small.xlsx",
      type: "source_file",
      totalSize: 4,
    });
    await expect(storeUploadChunk({
      uploadId: session.uploadId,
      userId: "owner-a",
      projectId: "project-a",
      partNumber: 0,
      checksum: "0".repeat(64),
      bytes: new Uint8Array([1, 2, 3, 4]),
    })).rejects.toThrow("分片校验失败");
    await expect(getChunkUpload(session.uploadId, "owner-b", "project-a")).rejects.toMatchObject({ status: 404 });
  });
});
