import { beforeEach, describe, expect, it, vi } from "vitest";
import { catalogMeta } from "@/data/catalog";
import { emptyEditorState } from "@/types/editor";
import type { CloudProjectSnapshot } from "@/src/server/projects/types";

const { database } = vi.hoisted(() => ({ database: {
  asset: { count: vi.fn() },
  globalProduct: { count: vi.fn() },
  templateDefinition: { count: vi.fn() },
  themeDefinition: { count: vi.fn() },
  brandKit: { count: vi.fn() },
} }));

vi.mock("@/src/server/db/prisma", () => ({ getPrisma: () => database }));

import { collectSnapshotReferences, validateSnapshotReferences } from "@/src/server/projects/referenceValidation";
import { assetIdFromReference } from "@/src/lib/assets/reference";

function snapshot(patch: Partial<CloudProjectSnapshot> = {}): CloudProjectSnapshot {
  return {
    project: { ...catalogMeta, design: { ...catalogMeta.design } },
    products: [],
    layoutMode: "smart",
    layoutOverrides: {},
    editorState: emptyEditorState(),
    ...patch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  database.asset.count.mockResolvedValue(0);
  database.globalProduct.count.mockResolvedValue(0);
  database.templateDefinition.count.mockResolvedValue(0);
  database.themeDefinition.count.mockResolvedValue(0);
  database.brandKit.count.mockResolvedValue(0);
});

describe("project snapshot resource isolation", () => {
  it("collects product, logo, layout and editor asset references once", () => {
    const input = snapshot({
      project: { ...catalogMeta, logo: "/ppt/api/assets/own-logo/content", design: { ...catalogMeta.design, logo: "asset://own-logo" } },
      products: [{ id: "p", productNumber: "1", sku: "S", packageCode: "S", name: "N", images: ["asset://own-image", "/ppt/api/assets/own-image/content"], details: [], price: { currency: "CNY" }, deliveryRegions: [], categoryId: "uncategorized" }],
      editorState: { ...emptyEditorState(), slides: { s: { slideId: "s", imageOverrides: { p: { source: "asset://editor-image", fit: "contain", scale: 1, offsetX: 0, offsetY: 0 } } } } },
    });
    expect(collectSnapshotReferences(input).assetIds.sort()).toEqual(["editor-image", "own-image", "own-logo"]);
  });

  it("allows only current-user resources and published system resources", async () => {
    const input = snapshot({ project: { ...catalogMeta, logo: "asset://owner-a-logo", design: { ...catalogMeta.design, templateDefinitionId: "system-template", themeDefinitionId: "owner-a-theme" } } });
    database.asset.count.mockImplementation(async ({ where }: { where: { id: { in: string[] }; OR: Array<Record<string, unknown>> } }) => where.id.in.filter((id) => id === "owner-a-logo").length);
    database.templateDefinition.count.mockResolvedValue(1);
    database.themeDefinition.count.mockResolvedValue(1);
    await expect(validateSnapshotReferences("owner-a", input)).resolves.toBeUndefined();
    expect(database.asset.count).toHaveBeenCalledWith({ where: expect.objectContaining({ OR: [{ userId: "owner-a" }, { isSystem: true }] }) });
    expect(database.templateDefinition.count).toHaveBeenCalledWith({ where: expect.objectContaining({ OR: [{ ownerId: "owner-a" }, { isSystem: true, status: "published" }] }) });
  });

  it("rejects an asset owned by a second user before a project write", async () => {
    const input = snapshot({ project: { ...catalogMeta, logo: "asset://owner-b-secret", design: { ...catalogMeta.design } } });
    database.asset.count.mockResolvedValue(0);
    await expect(validateSnapshotReferences("owner-a", input)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("rejects a foreign asset protocol reference with a path suffix instead of truncating its ID", async () => {
    const malformed = "asset://owner-b-secret/junk";
    expect(assetIdFromReference(malformed)).toBeUndefined();
    const input = snapshot({ project: { ...catalogMeta, logo: malformed, design: { ...catalogMeta.design, logo: malformed } } });
    expect(() => collectSnapshotReferences(input)).toThrow("格式不正确的素材引用");
    await expect(validateSnapshotReferences("owner-a", input)).rejects.toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
    expect(database.asset.count).not.toHaveBeenCalled();
  });

  it("rejects a foreign asset content route with a path suffix instead of truncating its ID", async () => {
    const malformed = "/ppt/api/assets/owner-b-secret/content/junk";
    expect(assetIdFromReference(malformed)).toBeUndefined();
    const input = snapshot({ project: { ...catalogMeta, logo: malformed, design: { ...catalogMeta.design, logo: malformed } } });
    expect(() => collectSnapshotReferences(input)).toThrow("格式不正确的素材引用");
    await expect(validateSnapshotReferences("owner-a", input)).rejects.toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
    expect(database.asset.count).not.toHaveBeenCalled();
  });

  it("rejects another user's template, theme and global product IDs", async () => {
    const product = { id: "p", globalProductId: "owner-b-product", productNumber: "1", sku: "S", packageCode: "S", name: "N", details: [], price: { currency: "CNY" as const }, deliveryRegions: [], categoryId: "uncategorized" as const };
    const input = snapshot({ project: { ...catalogMeta, design: { ...catalogMeta.design, templateDefinitionId: "owner-b-template", themeDefinitionId: "owner-b-theme" } }, products: [product] });
    await expect(validateSnapshotReferences("owner-a", input)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(database.globalProduct.count).toHaveBeenCalledWith({ where: expect.objectContaining({ ownerId: "owner-a" }) });
  });

  it("collects references nested inside batch editor sessions and overrides", () => {
    const input = snapshot({ batchConfig: {
      config: { logo: "asset://batch-logo" },
      groups: [{ projectConfig: { productDefaults: { globalProductId: "batch-product", image: "asset://batch-product-image" } }, editorSession: { project: { design: { templateDefinitionId: "batch-template", themeDefinitionId: "batch-theme" } } } }],
      productOverrides: [{ overrides: { brandKitId: "batch-brand-kit", images: ["asset://override-image"] } }],
    } });
    expect(collectSnapshotReferences(input)).toMatchObject({
      assetIds: expect.arrayContaining(["batch-logo", "batch-product-image", "override-image"]),
      globalProductIds: ["batch-product"],
      templateDefinitionIds: ["batch-template"],
      themeDefinitionIds: ["batch-theme"],
      brandKitIds: ["batch-brand-kit"],
    });
  });
});
