import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadSnapshotImages } from "@/src/lib/cloud/snapshotImages";
import { uploadProjectAsset } from "@/src/lib/cloud/upload";
import { CloudApiError } from "@/src/lib/cloud/apiError";

vi.mock("@/src/lib/cloud/upload", () => ({ uploadProjectAsset: vi.fn() }));
const upload = vi.mocked(uploadProjectAsset);
const image = (text: string) => `data:image/png;base64,${Buffer.from(text).toString("base64")}`;
const asset = (id: string) => ({ id, url: `/ppt/api/assets/${id}/content`, type: "product_image" as const, fileName: "image.png", mimeType: "image/png", size: 1, createdAt: "" });
beforeEach(() => { upload.mockReset(); upload.mockImplementation(async (_id, file, _type, progress) => { progress?.(50); progress?.(100); return asset(file.name); }); });
afterEach(() => vi.restoreAllMocks());

describe("PPT snapshot image upload", () => {
  it("settles active uploads and keeps deletion visible even if a later request times out", async () => {
    const deleted = new CloudApiError("项目已删除", 404, "PROJECT_DELETED");
    let settled = 0;
    upload.mockImplementation(async () => {
      const index = upload.mock.calls.length;
      await new Promise(resolve => setTimeout(resolve, index * 5));
      settled++;
      if (index === 1) throw deleted;
      throw new Error("timeout");
    });
    await expect(uploadSnapshotImages("old", [image("a"), image("b"), image("c"), image("d")], {}, vi.fn())).rejects.toBe(deleted);
    expect(settled).toBe(3); expect(upload).toHaveBeenCalledTimes(3);
  });
  it("uploads identical bytes once across different URLs and replaces all nested references", async () => {
    const source = image("same-image");
    const blobUrl = URL.createObjectURL(new Blob(["same-image"], { type: "image/png" }));
    try {
      const original = { project: { logo: blobUrl }, products: [{ image: source, images: [source, blobUrl], components: [{ image: source }] }], batch: { groups: [{ image: blobUrl }] }, remote: "https://images.example/test.png" };
      const result = await uploadSnapshotImages("p1", original, {}, vi.fn());
      expect(upload).toHaveBeenCalledTimes(1);
      expect(result.project.logo).toBe(result.products[0].image);
      expect(result.products[0].images).toEqual([result.project.logo, result.project.logo]);
      expect(result.batch.groups[0].image).toBe(result.project.logo);
      expect(result.remote).toBe(original.remote);
      expect(JSON.stringify(result)).not.toMatch(/data:image|blob:/);
      expect(original.products[0].image).toBe(source);
    } finally { URL.revokeObjectURL(blobUrl); }
  });

  it("turns a repeated large image snapshot into small reference-only JSON", async () => {
    const source = image("x".repeat(1024 * 1024));
    const snapshot = { products: Array.from({ length: 84 }, () => ({ image: source, images: [source], components: [{ image: source }] })) };
    const result = await uploadSnapshotImages("p1", snapshot, {}, vi.fn());
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][1].size).toBe(1024 * 1024);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(100_000);
  });

  it("preserves successful receipts and retries only failed content", async () => {
    const snapshot = [image("a"), image("b"), image("c"), image("d")];
    const receipts: Record<string, string> = {};
    upload.mockImplementationOnce(async () => asset("first"));
    upload.mockImplementationOnce(async () => { throw new Error("offline"); });
    await expect(uploadSnapshotImages("p1", snapshot, receipts, vi.fn())).rejects.toThrow("offline");
    const saved = Object.keys(receipts).length;
    expect(saved).toBeGreaterThan(0);
    upload.mockClear();
    const result = await uploadSnapshotImages("p1", snapshot, receipts, vi.fn());
    expect(upload).toHaveBeenCalledTimes(4 - saved);
    expect(result).toHaveLength(4);
    expect(result.every((url) => url.startsWith("/ppt/api/assets/"))).toBe(true);
  });

  it("bounds simultaneous requests and reports upload progress", async () => {
    let active = 0; let peak = 0;
    upload.mockImplementation(async (_id, file, _type, report) => {
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      report?.(100); active--; return asset(file.name);
    });
    const progress = vi.fn();
    await uploadSnapshotImages("p1", Array.from({ length: 9 }, (_, i) => image(String(i))), {}, progress);
    expect(peak).toBe(3);
    expect(progress.mock.calls.some(([text]) => text.includes("100%"))).toBe(true);
  });

  it("fails explicitly for unreadable local images without submitting a broken snapshot", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    await expect(uploadSnapshotImages("p1", { image: "blob:missing" }, {}, vi.fn())).rejects.toThrow("图片读取失败");
    expect(upload).not.toHaveBeenCalled();
  });

  it("leaves existing asset references unchanged without network access", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const input = { image: "/ppt/api/assets/existing/content", image2: "asset://existing" };
    expect(await uploadSnapshotImages("p1", input, {}, vi.fn())).toEqual(input);
    expect(fetch).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});
