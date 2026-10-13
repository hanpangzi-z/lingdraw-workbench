import { beforeEach, describe, expect, it, vi } from "vitest";
import { catalogMeta } from "@/data/catalog";
import { emptyEditorState } from "@/types/editor";

const mocks = vi.hoisted(() => ({
  database: {
    projectProductSnapshot: { findMany: vi.fn() },
    productCategory: { findFirst: vi.fn() },
    globalProduct: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    templateDefinition: { findUnique: vi.fn(), update: vi.fn() },
    brandKit: { findUnique: vi.fn() },
    themeDefinition: { findUnique: vi.fn() },
  },
  assertProjectOwner: vi.fn(),
  getProject: vi.fn(),
  validateAssetReferences: vi.fn(),
}));

vi.mock("@/src/server/db/prisma", () => ({ getPrisma: () => mocks.database }));
vi.mock("@/src/server/assets/service", () => ({
  assertProjectOwner: mocks.assertProjectOwner,
  assetIdFromUrl: (value?: string) => value?.match(/\/api\/assets\/([^/?#]+)\/content/)?.[1],
  assetUrl: (id?: string | null) => id ? `/ppt/api/assets/${id}/content` : undefined,
  createAsset: vi.fn(),
}));
vi.mock("@/src/server/projects/service", () => ({
  getProject: mocks.getProject,
  createProject: vi.fn(),
  saveProject: vi.fn(),
}));
vi.mock("@/src/server/projects/referenceValidation", () => ({ validateAssetReferences: mocks.validateAssetReferences }));

import { getProjectProductSync, saveProjectProductToLibrary } from "@/src/server/library/products";
import { updateTemplate } from "@/src/server/library/templates";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertProjectOwner.mockResolvedValue({ id: "project-a", userId: "owner-a" });
  mocks.validateAssetReferences.mockResolvedValue(undefined);
  mocks.database.productCategory.findFirst.mockResolvedValue(null);
  mocks.database.globalProduct.findUnique.mockResolvedValue(null);
});

describe("resource-library tenant isolation", () => {
  it("fails closed when an existing project row points at another user's global product", async () => {
    mocks.database.projectProductSnapshot.findMany.mockResolvedValue([{ globalProductVersion: 1, globalProduct: { id: "foreign-product", ownerId: "owner-b", deletedAt: null, revision: 2 } }]);
    await expect(getProjectProductSync("owner-a", "project-a")).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
  });

  it("validates project image ownership before writing a product-library record", async () => {
    const product = { id: "p1", productNumber: "1", sku: "S1", packageCode: "S1", name: "Product", image: "/ppt/api/assets/owner-b-secret/content", details: [], price: { currency: "CNY" as const }, deliveryRegions: [], categoryId: "uncategorized" as const };
    mocks.getProject.mockResolvedValue({ id: "project-a", revision: 1, snapshot: { project: catalogMeta, products: [product], layoutMode: "smart", layoutOverrides: {}, editorState: emptyEditorState() } });
    mocks.validateAssetReferences.mockRejectedValue(Object.assign(new Error("forbidden"), { status: 403, code: "FORBIDDEN" }));
    await expect(saveProjectProductToLibrary("owner-a", "project-a", { clientId: "p1" })).rejects.toMatchObject({ status: 403 });
    expect(mocks.validateAssetReferences).toHaveBeenCalledWith("owner-a", ["owner-b-secret"]);
    expect(mocks.database.globalProduct.create).not.toHaveBeenCalled();
  });

  it("rejects another user's brand kit before updating a template", async () => {
    mocks.database.templateDefinition.findUnique.mockResolvedValue({
      id: "template-a", ownerId: "owner-a", isSystem: false, status: "draft", deletedAt: null,
      name: "Template", description: null, category: "catalog", version: 1, rendererKey: "business-standard",
      config: {}, tags: [], searchText: "Template", usageCount: 0, previewDirty: false, thumbnailAssetId: null,
      themeDefinitionId: null, brandKitId: null, scope: "personal", createdAt: new Date(), updatedAt: new Date(),
      themeDefinition: null, brandKit: null, favorites: [],
    });
    mocks.database.brandKit.findUnique.mockResolvedValue({ ownerId: "owner-b" });
    await expect(updateTemplate("owner-a", "template-a", { brandKitId: "brand-kit-b" })).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(mocks.database.templateDefinition.update).not.toHaveBeenCalled();
  });
});
