import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHUNK_UPLOAD_BYTES, uploadProjectAsset } from "@/src/lib/cloud/upload";
import { isProjectDeleted } from "@/src/lib/cloud/apiError";

class FakeXmlHttpRequest {
  static sent: Blob[] = [];
  static responseStatuses: number[] = [];
  method = "";
  url = "";
  status = 0;
  responseText = "";
  headers = new Map<string, string>();
  upload: { onprogress?: (event: { loaded: number; total: number; lengthComputable: boolean }) => void } = {};
  onerror?: () => void;
  onload?: () => void;

  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers.set(name.toLowerCase(), value); }
  send(body: Blob) {
    FakeXmlHttpRequest.sent.push(body);
    queueMicrotask(() => {
      this.upload.onprogress?.({ loaded: body.size, total: body.size, lengthComputable: true });
      this.status = FakeXmlHttpRequest.responseStatuses.shift() ?? 200;
      this.responseText = JSON.stringify({ ok: true });
      this.onload?.();
    });
  }
}

const asset = {
  id: "asset-a",
  type: "source_file" as const,
  fileName: "catalog.pdf",
  mimeType: "application/pdf",
  size: CHUNK_UPLOAD_BYTES + 3,
  createdAt: new Date(0).toISOString(),
  url: "/ppt/api/assets/asset-a/content",
};

beforeEach(() => {
  FakeXmlHttpRequest.sent = [];
  FakeXmlHttpRequest.responseStatuses = [];
  vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);
  const fakeWindow: { parent?: unknown; location: { origin: string } } = { location: { origin: "http://localhost" } };
  fakeWindow.parent = fakeWindow;
  vi.stubGlobal("window", fakeWindow);
});

afterEach(() => vi.unstubAllGlobals());

describe("chunked upload client", () => {
  it("preserves deletion errors for direct uploads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"asset":null}')));
    vi.stubGlobal("XMLHttpRequest", class extends FakeXmlHttpRequest {
      send() { queueMicrotask(() => { this.status = 404; this.responseText = JSON.stringify({ error: "项目已删除", code: "PROJECT_DELETED" }); this.onload?.(); }); }
    });
    const error = await uploadProjectAsset("old", new File(["image"], "small.png"), "product_image").catch((error) => error);
    expect(isProjectDeleted(error)).toBe(true);
  });
  it.each(["plan", "chunk", "complete"])("preserves deletion errors at the %s stage without retrying", async (stage) => {
    const deleted = () => new Response(JSON.stringify({ error: "项目已删除", code: "PROJECT_DELETED" }), { status: 404 });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    fetchMock.mockResolvedValueOnce(stage === "plan" ? deleted() : new Response(JSON.stringify({ uploadId: "test", chunkSize: CHUNK_UPLOAD_BYTES, chunkCount: 2 }), { status: 201 }));
    if (stage === "complete") fetchMock.mockResolvedValueOnce(deleted());
    if (stage === "chunk") vi.stubGlobal("XMLHttpRequest", class extends FakeXmlHttpRequest {
      send(body: Blob) { FakeXmlHttpRequest.sent.push(body); queueMicrotask(() => { this.status = 404; this.responseText = JSON.stringify({ error: "项目已删除", code: "PROJECT_DELETED" }); this.onload?.(); }); }
    });
    vi.stubGlobal("fetch", fetchMock);
    const error = await uploadProjectAsset("old", new File([new Uint8Array(CHUNK_UPLOAD_BYTES + 1)], "source.xlsx"), "source_file").catch((error) => error);
    expect(isProjectDeleted(error)).toBe(true);
    expect(FakeXmlHttpRequest.sent).toHaveLength(stage === "plan" ? 0 : stage === "chunk" ? 1 : 2);
    expect(fetchMock).toHaveBeenCalledTimes(stage === "plan" ? 1 : 2);
  });
  it("rejects a direct upload timeout instead of leaving creation pending", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response('{"asset":null}')));
    let configuredTimeout = 0;
    vi.stubGlobal("XMLHttpRequest", class extends FakeXmlHttpRequest {
      timeout = 0;
      ontimeout?: () => void;
      send() { configuredTimeout = this.timeout; queueMicrotask(() => this.ontimeout?.()); }
    });
    const pending = expect(uploadProjectAsset("project", new File(["image"], "small.png"), "product_image")).rejects.toThrow("结果暂未确认");
    await vi.waitFor(() => expect(configuredTimeout).toBe(120_000));
    await vi.runAllTimersAsync(); await pending; vi.useRealTimers();
    expect(configuredTimeout).toBe(120_000);
  });
  it("uploads files over 5MB as checksummed chunks and completes once", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ uploadId: "00000000-0000-4000-8000-000000000001", chunkSize: CHUNK_UPLOAD_BYTES, chunkCount: 2 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ asset }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([new Uint8Array(CHUNK_UPLOAD_BYTES + 3).fill(9)], "catalog.pdf", { type: "application/pdf" });
    const progress: number[] = [];

    await expect(uploadProjectAsset("project-a", file, "source_file", (value) => progress.push(value))).resolves.toEqual(asset);

    expect(FakeXmlHttpRequest.sent.map((chunk) => chunk.size)).toEqual([CHUNK_UPLOAD_BYTES, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ fileName: "catalog.pdf", size: CHUNK_UPLOAD_BYTES + 3, type: "source_file" });
    expect(progress.at(-1)).toBe(100);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
  });

  it("retries a transiently failed chunk without regressing progress", async () => {
    FakeXmlHttpRequest.responseStatuses = [503, 200, 200];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ uploadId: "00000000-0000-4000-8000-000000000002", chunkSize: CHUNK_UPLOAD_BYTES, chunkCount: 2 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ asset }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File([new Uint8Array(CHUNK_UPLOAD_BYTES + 3).fill(9)], "catalog.pdf", { type: "application/pdf" });
    const progress: number[] = [];

    await expect(uploadProjectAsset("project-a", file, "source_file", (value) => progress.push(value))).resolves.toEqual(asset);

    expect(FakeXmlHttpRequest.sent.map((chunk) => chunk.size)).toEqual([CHUNK_UPLOAD_BYTES, CHUNK_UPLOAD_BYTES, 3]);
    expect(progress.at(-1)).toBe(100);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1])).toBe(true);
  });
});
