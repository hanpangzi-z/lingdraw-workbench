import { beforeEach, describe, expect, it, vi } from "vitest";
import { catalogMeta } from "@/data/catalog";
import { mockProducts } from "@/data/mock-products";
import { emptyEditorState } from "@/types/editor";
import type { CloudProjectSnapshot } from "@/src/server/projects/types";

const mocks = vi.hoisted(() => ({
  owner: vi.fn(), validate: vi.fn(), thumbnail: vi.fn(),
  db: { project: { findUniqueOrThrow: vi.fn() }, $transaction: vi.fn() },
  tx: {
    project: { findUniqueOrThrow: vi.fn(), updateMany: vi.fn() },
    projectVersion: { findUnique: vi.fn(), aggregate: vi.fn(), create: vi.fn() },
    projectProductSnapshot: { deleteMany: vi.fn(), createMany: vi.fn() },
    projectDesign: { upsert: vi.fn() }, projectEditorState: { upsert: vi.fn() },
  },
}));
vi.mock("@/src/server/db/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("@/src/server/assets/service", () => ({ assertProjectOwner: mocks.owner, assetIdFromUrl: () => undefined, assetUrl: () => undefined }));
vi.mock("@/src/server/projects/referenceValidation", () => ({ validateSnapshotReferences: mocks.validate }));
vi.mock("@/src/server/projects/thumbnail", () => ({ refreshProjectThumbnail: mocks.thumbnail }));

import { saveProject } from "@/src/server/projects/service";

const requestId = "2965f9a9-46b0-4441-b649-af6ab97f70ca";
const snapshot = (): CloudProjectSnapshot => ({ project: catalogMeta, products: mockProducts.slice(0, 1).map((p) => ({ ...p, image: undefined, images: [] })), editorState: emptyEditorState(), layoutMode: "smart", layoutOverrides: {} });
const previous = () => ({
  id: "project", userId: "owner", revision: 7, name: "Original", region: "上海", priceTier: "500", themeId: "corporate-blue", templateId: "corporate-blue", products: [],
  design: { templateId: "corporate-blue", themeId: "corporate-blue", brandColor: "#123456", themeOverrides: {} },
  editorState: { slideOverrides: { s1: { slideId: "s1", customTitle: "原稿手动标题" } }, manualSlides: {}, pageOrder: ["s1"], hiddenSlideIds: [], lockedSlideIds: ["s1"] },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.owner.mockResolvedValue({ id: "project", userId: "owner" });
  mocks.db.project.findUniqueOrThrow.mockResolvedValue({ name: "Original", thumbnailDirty: true });
  mocks.db.$transaction.mockImplementation((fn) => fn(mocks.tx));
  mocks.tx.project.findUniqueOrThrow.mockImplementation(async (args) => args.include ? previous() : { revision: 8, updatedAt: new Date(0) });
  mocks.tx.project.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.projectVersion.findUnique.mockResolvedValue(null);
  mocks.tx.projectVersion.aggregate.mockResolvedValue({ _max: { versionNumber: 3 } });
  mocks.thumbnail.mockResolvedValue(undefined);
});

describe("atomic project reimport", () => {
  it("backs up the prior design and editor before deleting any product rows", async () => {
    await saveProject("owner", "project", 7, snapshot(), { reimportRequestId: requestId });
    const backup = mocks.tx.projectVersion.create.mock.calls[0][0].data;
    expect(backup).toMatchObject({ versionNumber: 4, label: "重新导入前自动备份", reason: "reimport", createdById: "owner" });
    expect(backup.snapshot.project.design.brandColor).toBe("#123456");
    expect(backup.snapshot.editorState.slides.s1.customTitle).toBe("原稿手动标题");
    expect(backup.snapshot.editorState.lockedSlideIds).toEqual(["s1"]);
    expect(mocks.tx.projectVersion.create.mock.invocationCallOrder[0]).toBeLessThan(mocks.tx.projectProductSnapshot.deleteMany.mock.invocationCallOrder[0]);
  });
  it("does not delete products when the backup fails", async () => {
    mocks.tx.projectVersion.create.mockRejectedValue(new Error("backup unavailable"));
    await expect(saveProject("owner", "project", 7, snapshot(), { reimportRequestId: requestId })).rejects.toThrow("backup unavailable");
    expect(mocks.tx.projectProductSnapshot.deleteMany).not.toHaveBeenCalled();
  });
  it("propagates replacement failure out of the transaction for rollback", async () => {
    mocks.tx.projectProductSnapshot.createMany.mockRejectedValue(new Error("write unavailable"));
    await expect(saveProject("owner", "project", 7, snapshot(), { reimportRequestId: requestId })).rejects.toThrow("write unavailable");
    expect(mocks.thumbnail).not.toHaveBeenCalled();
  });
  it("rejects an empty or unnamed import before starting the transaction", async () => {
    await expect(saveProject("owner", "project", 7, { ...snapshot(), products: [] }, { reimportRequestId: requestId })).rejects.toMatchObject({ status: 400 });
    const invalid = snapshot(); invalid.products[0].name = " ";
    await expect(saveProject("owner", "project", 7, invalid, { reimportRequestId: requestId })).rejects.toMatchObject({ status: 400 });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
  it("does not overwrite a newer project revision", async () => {
    await expect(saveProject("owner", "project", 6, snapshot(), { reimportRequestId: requestId })).rejects.toMatchObject({ status: 409 });
    expect(mocks.tx.projectVersion.create).not.toHaveBeenCalled();
    expect(mocks.tx.projectProductSnapshot.deleteMany).not.toHaveBeenCalled();
  });
  it("checks the revision again if another save wins after the backup read", async () => {
    mocks.tx.project.updateMany.mockResolvedValue({ count: 0 });
    await expect(saveProject("owner", "project", 7, snapshot(), { reimportRequestId: requestId })).rejects.toMatchObject({ status: 409 });
    expect(mocks.tx.projectVersion.create).not.toHaveBeenCalled();
  });
  it("retries a committed request without replacing data or creating another version", async () => {
    mocks.tx.projectVersion.findUnique.mockResolvedValue({ id: `reimport-project-${requestId}` });
    await expect(saveProject("owner", "project", 7, snapshot(), { reimportRequestId: requestId })).resolves.toMatchObject({ revision: 8 });
    expect(mocks.tx.project.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.projectVersion.create).not.toHaveBeenCalled();
    expect(mocks.tx.projectProductSnapshot.deleteMany).not.toHaveBeenCalled();
    expect(mocks.thumbnail).not.toHaveBeenCalled();
  });
  it("reports deletion if a concurrent delete wins after the owner check", async () => {
    mocks.tx.project.updateMany.mockResolvedValue({ count: 0 });
    mocks.tx.project.findUniqueOrThrow.mockResolvedValue({ deletedAt: new Date() });
    await expect(saveProject("owner", "project", 7, snapshot())).rejects.toMatchObject({ status: 404, code: "PROJECT_DELETED" });
    expect(mocks.tx.projectProductSnapshot.deleteMany).not.toHaveBeenCalled();
  });
  it("keeps ordinary autosaves free of automatic reimport versions", async () => {
    await saveProject("owner", "project", 7, snapshot());
    expect(mocks.tx.projectVersion.create).not.toHaveBeenCalled();
    expect(mocks.tx.projectProductSnapshot.createMany).toHaveBeenCalledOnce();
  });
  it("rejects foreign project ownership before backing up or replacing", async () => {
    mocks.owner.mockRejectedValue(Object.assign(new Error("Forbidden"), { status: 403 }));
    await expect(saveProject("stranger", "project", 7, snapshot(), { reimportRequestId: requestId })).rejects.toMatchObject({ status: 403 });
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });
});
