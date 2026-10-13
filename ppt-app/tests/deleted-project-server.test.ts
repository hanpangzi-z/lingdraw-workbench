import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ project: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() } }));
vi.mock("@/src/server/db/prisma", () => ({ getPrisma: () => db }));
vi.mock("@/src/server/projects/referenceValidation", () => ({ validateSnapshotReferences: vi.fn() }));
vi.mock("@/src/server/projects/thumbnail", () => ({ refreshProjectThumbnail: vi.fn() }));
import { assertProjectOwner } from "@/src/server/assets/service";
import { createProject, getProject } from "@/src/server/projects/service";
import { errorResponse, ProjectDeletedError } from "@/src/server/errors";
beforeEach(() => vi.resetAllMocks());

describe("deleted project API contract", () => {
  it("keeps HTTP 404 and the existing message with a specific code", async () => {
    const response = errorResponse(new ProjectDeletedError());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "项目已删除", code: "PROJECT_DELETED" });
  });
  it.each([assertProjectOwner, (id: string, user: string) => getProject(user, id)])("checks existence and ownership before disclosing deletion", async (read) => {
    db.project.findUnique.mockResolvedValue(null);
    await expect(read("project", "me")).rejects.toMatchObject({ code: "NOT_FOUND" });
    db.project.findUnique.mockResolvedValue({ id: "project", userId: "other", deletedAt: new Date() });
    await expect(read("project", "me")).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    db.project.findUnique.mockResolvedValue({ id: "project", userId: "me", deletedAt: new Date() });
    await expect(read("project", "me")).rejects.toMatchObject({ status: 404, code: "PROJECT_DELETED" });
    expect(db.project.update).not.toHaveBeenCalled();
  });
  it("rejects a reused creation key for a deleted project without restoring it", async () => {
    db.project.findUnique.mockResolvedValue({ id: "old", userId: "me", deletedAt: new Date() });
    await expect(createProject("me", { creationKey: "2965f9a9-46b0-4441-b649-af6ab97f70ca" })).rejects.toMatchObject({ code: "PROJECT_DELETED" });
    expect(db.project.upsert).not.toHaveBeenCalled(); expect(db.project.update).not.toHaveBeenCalled();
  });
  it("detects a concurrent deleted record returned by the idempotent upsert", async () => {
    db.project.findUnique.mockResolvedValue(null);
    db.project.upsert.mockResolvedValue({ id: "old", userId: "me", deletedAt: new Date() });
    await expect(createProject("me", { name: "恢复验证", creationKey: "2965f9a9-46b0-4441-b649-af6ab97f70ca" })).rejects.toMatchObject({ code: "PROJECT_DELETED" });
    expect(db.project.update).not.toHaveBeenCalled();
  });
});
