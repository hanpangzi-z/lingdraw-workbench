import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { requireSaved, recoveryAction } from "@/src/lib/cloud/saveResult";
import { loadImageAsset } from "@/src/lib/ppt/helpers";
import { encodeDraft, decodeDraft } from "@/src/lib/cloud/draftCodec";
import { buildPpt } from "@/src/lib/ppt/generatePpt";
import { catalogMeta } from "@/data/catalog";
import { mockProducts } from "@/data/mock-products";
import { createSlidePlan } from "@/src/lib/layout/createSlidePlan";

describe("workbench state protection", () => {
  it("keeps equal/stale revisions, including undo history", () => {
    expect(recoveryAction(4, 4, false)).toBe("keep");
    expect(recoveryAction(4, 3, true)).toBe("keep");
  });
  it("only restores a newer revision if local state is clean", () => {
    expect(recoveryAction(4, 5, false)).toBe("restore");
    expect(recoveryAction(4, 5, true)).toBe("conflict");
  });
  it("blocks downstream version creation/export after a failed save", async () => {
    const next = vi.fn();
    const action = async () => { requireSaved({ ok: false, message: "离线" }); next(); };
    await expect(action()).rejects.toThrow("离线");
    expect(next).not.toHaveBeenCalled();
  });
  it("retries failed image loads instead of caching failure forever", async () => {
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 503 }));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await loadImageAsset("https://images.example.test/retry-safety.png");
      await loadImageAsset("https://images.example.test/retry-safety.png");
      expect(mock).toHaveBeenCalledTimes(2);
    } finally { mock.mockRestore(); warning.mockRestore(); }
  });
  it("retains original source Files and binary spreadsheet data in local drafts", async () => {
    const file = new File(["source"], "products.csv");
    const binary = new Uint8Array([1, 2, 3]);
    const input = { files: [file], binary, name: "draft" };
    const encoded = await encodeDraft(input);
    const draft = await decodeDraft<typeof input>(encoded.metadata, encoded.assets);
    expect(await draft.files[0].text()).toBe("source");
    expect(draft.binary).toEqual(binary);
  });
  it("reads a repeated blob URL only once per draft checkpoint", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Blob(["image"], { type: "image/png" })));
    class Reader {
      result = "data:image/png;base64,aW1hZ2U=";
      onload?: () => void;
      readAsDataURL() { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal("FileReader", Reader);
    try {
      const input = { logo: "blob:repeated", products: [{ image: "blob:repeated", images: ["blob:repeated"] }] };
      const encoded = await encodeDraft(input);
      const result = await decodeDraft<typeof input>(encoded.metadata, encoded.assets);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.logo).toBe(result.products[0].image);
      expect(result.logo).toBe(result.products[0].images[0]);
    } finally { fetch.mockRestore(); vi.unstubAllGlobals(); }
  });
  it("reports the actual slide using a failed image, not every slide", async () => {
    const source = "https://images.example.test/missing-product.png";
    const good = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlQn0YAAAAASUVORK5CYII=";
    const originalFetch = globalThis.fetch;
    const mock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => String(input) === source ? Promise.resolve(new Response("", { status: 503 })) : originalFetch(input, init));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const products = mockProducts.slice(0, 2).map((product, i) => ({ ...product, components: undefined, image: i ? good : source, images: [i ? good : source] }));
      const result = await buildPpt({ meta: catalogMeta, products, categories: [], slidePlans: createSlidePlan(products, { mode: "force-single-image" }) });
      expect(result.warnings).toEqual([`第 2 页 · 图片加载失败：${source}`]);
    } finally { mock.mockRestore(); warning.mockRestore(); }
  });
  it("keeping the current template only closes the gallery", () => {
    const source = fs.readFileSync("components/studio/TemplateGallery.tsx", "utf8");
    expect(source).toContain("if (!selected) onApply(template.id)");
  });
  it("host activation never unconditionally refreshes the route", () => {
    const source = fs.readFileSync("components/host/LingDrawBridge.tsx", "utf8");
    expect(source).not.toContain("router.refresh()");
  });
});
