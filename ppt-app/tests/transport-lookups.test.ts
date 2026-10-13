import { beforeEach, describe, expect, it, vi } from "vitest";
const { db } = vi.hoisted(() => ({ db: { project: { findUnique: vi.fn() }, projectAsset: { findFirst: vi.fn() }, sourceFile: { findFirst: vi.fn() } } }));
vi.mock("@/src/server/db/prisma", () => ({ getPrisma: () => db }));
import { findUploadedProjectAsset } from "@/src/server/assets/service";
import { getProjectByCreationKey } from "@/src/server/projects/service";
beforeEach(() => { vi.resetAllMocks(); db.project.findUnique.mockResolvedValue({ id: "p", userId: "u", deletedAt: null }); });
describe("read-only transport lookups", () => {
  it.each([
    [null, 404, "NOT_FOUND"],
    [{ id: "p", userId: "other", deletedAt: null }, 403, "FORBIDDEN"],
    [{ id: "p", userId: "u", deletedAt: new Date() }, 404, "PROJECT_DELETED"],
  ])("checks project ownership/deletion before revealing upload receipts", async (project, status, code) => {
    db.project.findUnique.mockResolvedValue(project);
    await expect(findUploadedProjectAsset("p", "u", "a".repeat(64), "product_image")).rejects.toMatchObject({ status, code });
    expect(db.projectAsset.findFirst).not.toHaveBeenCalled();
  });
  it("looks up only a linked same-owner hash with the requested role", async () => {
    db.projectAsset.findFirst.mockResolvedValue(null);
    await expect(findUploadedProjectAsset("p", "u", "a".repeat(64), "product_image")).resolves.toBeNull();
    expect(db.projectAsset.findFirst).toHaveBeenCalledWith({ where: { projectId: "p", role: "product_image", asset: { userId: "u", checksum: "a".repeat(64), deletedAt: null } }, include: { asset: true } });
  });
  it("does not acknowledge a source file before its metadata has committed", async () => {
    db.projectAsset.findFirst.mockResolvedValue({ asset: { id: "a" } }); db.sourceFile.findFirst.mockResolvedValue(null);
    await expect(findUploadedProjectAsset("p", "u", "a".repeat(64), "source_file")).resolves.toBeNull();
  });
  it("validates creation keys and does not create anything during lookup", async () => {
    await expect(getProjectByCreationKey("u", "bad")).rejects.toMatchObject({ status: 400 });
    expect(db.project.findUnique).not.toHaveBeenCalled(); db.project.findUnique.mockResolvedValue(null);
    await expect(getProjectByCreationKey("u", "00000000-0000-4000-8000-000000000017")).resolves.toBeNull();
    expect(db.project.findUnique.mock.calls[0][0].where.id).toMatch(/^draft-[a-f0-9]{64}$/);
  });
});
