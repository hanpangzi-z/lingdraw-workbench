import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudApiError, isProjectDeleted, parseCloudResponse, recoverCloudResult } from "@/src/lib/cloud/apiError";
import { createPendingProject, savePendingProject, sameSavedSnapshot } from "@/src/lib/cloud/pendingTransport";
import { rawDataWithProductComponents, withDerivedProductComponents } from "@/src/lib/catalog/components";
import { uploadProjectAsset } from "@/src/lib/cloud/upload";
import { catalogMeta } from "@/data/catalog";
import { emptyEditorState } from "@/types/editor";
import type { CloudProjectSnapshot } from "@/src/server/projects/types";

const snapshot: CloudProjectSnapshot = { project: catalogMeta, products: [], layoutMode: "smart", layoutOverrides: {}, editorState: emptyEditorState() };
const detail = (revision = 1) => ({ id: "project", revision, snapshot });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => {
  vi.stubGlobal("window", { location: { origin: "http://localhost" }, parent: { postMessage: vi.fn() } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("PPT transport recovery", () => {
  it.each([200, 502, 504, 413])("does not leak an HTML JSON parser error (HTTP %s)", status => {
    expect(() => parseCloudResponse('<html><h1>proxy</h1></html>', status, "保存项目")).toThrow(CloudApiError);
    try { parseCloudResponse('<html>secret proxy text</html>', status, "保存项目"); } catch (error) {
      expect(error).toMatchObject({ status }); expect(String(error)).not.toMatch(/Unexpected token|secret proxy/);
    }
  });
  it("preserves explicit deletion identity", () => {
    try { parseCloudResponse('{"error":"项目已删除","code":"PROJECT_DELETED"}', 404, "保存"); }
    catch (error) { expect(isProjectDeleted(error)).toBe(true); }
  });
  it("recovers a created project after HTML 504 without a second POST", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ project: null }))
      .mockResolvedValueOnce(new Response('<html>timeout</html>', { status: 504 }))
      .mockResolvedValueOnce(response({ project: detail() }));
    vi.stubGlobal("fetch", fetch);
    await expect(createPendingProject("fixed-key", "name", vi.fn())).resolves.toMatchObject({ id: "project" });
    expect(fetch.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
  });
  it("recovers refresh/manual retry from creation key before sending any POST", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ project: detail() })); vi.stubGlobal("fetch", fetch);
    await createPendingProject("fixed-key", "name", vi.fn());
    expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][1].method).toBeUndefined();
  });
  it("does not create on a malformed lookup response", async () => {
    const fetch = vi.fn().mockResolvedValue(response({})); vi.stubGlobal("fetch", fetch);
    await expect(createPendingProject("fixed-key", "name", vi.fn())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 404, 413])("does not retry or recreate on HTTP %s", async status => {
    const fetch = vi.fn().mockResolvedValueOnce(response({ project: null })).mockResolvedValueOnce(new Response('<html>error</html>', { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(createPendingProject("key", "name", vi.fn())).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("recovers committed save after lost response without another PUT", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(response(detail())).mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(response(detail(2))); vi.stubGlobal("fetch", fetch);
    await expect(savePendingProject(detail(), snapshot, vi.fn())).resolves.toEqual({ revision: 2 });
    expect(fetch.mock.calls.filter(([, init]) => init.method === "PUT")).toHaveLength(1);
  });
  it("never treats a different concurrent edit as a successful save", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ ...detail(2), snapshot: { ...snapshot, project: { ...catalogMeta, title: "someone else's edit" } } }));
    vi.stubGlobal("fetch", fetch);
    await expect(savePendingProject(detail(), snapshot, vi.fn())).rejects.toMatchObject({ status: 409 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("compares persisted component metadata, not the lossy derived display fields", () => {
    const product = { id: "p", productNumber: "1", sku: "a", packageCode: "a", name: "package", details: [], deliveryRegions: [], categoryId: "uncategorized" as const, price: { currency: "CNY" as const, market: 9 }, components: [{ name: "beef", brand: "brand", details: ["500g"], marketPrice: 10 }] };
    const { components: _, ...fields } = product;
    const stored = withDerivedProductComponents({ ...fields, featured: false, images: [], rawData: rawDataWithProductComponents(product) });
    expect(sameSavedSnapshot({ ...snapshot, products: [product] }, { ...snapshot, products: [stored] })).toBe(true);
    const changed = { ...stored, rawData: { ...stored.rawData, productComponents: [{ name: "other", details: [] }] } };
    expect(sameSavedSnapshot({ ...snapshot, products: [product] }, { ...snapshot, products: [changed] })).toBe(false);
  });
  it("bounds recovery, keeps unknown distinct from failure, and stops on login failure", async () => {
    vi.useFakeTimers(); const query = vi.fn().mockResolvedValue(undefined);
    const pending = expect(recoverCloudResult(query, "上传")).rejects.toMatchObject({ code: "RESULT_UNKNOWN" });
    await vi.runAllTimersAsync(); await pending; expect(query).toHaveBeenCalledTimes(4);
    const denied = vi.fn().mockRejectedValue(new CloudApiError("login", 401));
    await expect(recoverCloudResult(denied, "上传")).rejects.toMatchObject({ status: 401 }); expect(denied).toHaveBeenCalledTimes(1);
  });
  it.each([502, 200])("recovers a direct upload after malformed HTTP %s and reports 100% only after confirmation", async httpStatus => {
    let posts = 0;
    vi.stubGlobal("XMLHttpRequest", class {
      status = httpStatus; responseText = httpStatus === 200 ? '{}' : '<html>bad gateway</html>'; upload = {}; onload?: () => void;
      open() {} send() { posts++; queueMicrotask(() => this.onload?.()); }
    });
    const asset = { id: "asset", url: "/ppt/api/assets/asset/content" };
    const fetch = vi.fn().mockResolvedValueOnce(response({ asset: null })).mockResolvedValueOnce(response({ asset })); vi.stubGlobal("fetch", fetch);
    const progress = vi.fn(); const status = vi.fn();
    await expect(uploadProjectAsset("project", new File(["image"], "x.png"), "product_image", progress, status)).resolves.toEqual(asset);
    expect(posts).toBe(1); expect(progress).toHaveBeenLastCalledWith(100); expect(status).toHaveBeenCalled();
  });
  it("finds an existing upload after refresh without reuploading", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ asset: { id: "same", url: "/ppt/api/assets/same/content" } })));
    const XHR = vi.fn(); vi.stubGlobal("XMLHttpRequest", XHR);
    await expect(uploadProjectAsset("project", new File(["image"], "x.png"), "product_image")).resolves.toMatchObject({ id: "same" });
    expect(XHR).not.toHaveBeenCalled();
  });
});
