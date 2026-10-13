import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { LingDrawUser } from "@/src/server/auth/session";
const mocks = vi.hoisted(() => ({ owner: vi.fn(), execute: vi.fn(), asset: vi.fn() }));
vi.mock("@/src/server/assets/service", () => ({ assertProjectOwner: mocks.owner, serializeAsset: (asset: unknown) => asset }));
vi.mock("@/src/server/db/prisma", async importOriginal => {
  const actual = await importOriginal<typeof import("@/src/server/db/prisma")>();
  return { getPrisma: () => ({ asset: { findFirst: mocks.asset }, imageGenerationJob: actual.getPrisma().imageGenerationJob }) };
});
vi.mock("@/src/server/ai/imageGeneration", async importOriginal => ({ ...await importOriginal<object>(), executeImageGeneration: mocks.execute }));
import { beginImageJob, getImageJob, runImageJob } from "@/src/server/ai/imageJobs";
import { getPrisma } from "@/src/server/db/prisma";
const user: LingDrawUser = { id: "test-owner", externalUserId: "test", username: "test", email: "test@example.test", name: null, avatarUrl: null, role: "user" };
let root: string;
function form(prompt = "scene") {
  const value = new FormData();
  Object.entries({ prompt, productName: "test", provider: "test", model: "test", projectId: "project-a", aspectRatio: "1" }).forEach(([key, data]) => value.set(key, data));
  value.append("images", new File(["image-test-bytes"], "test.png", { type: "image/png" }));
  return value;
}
beforeEach(async () => {
  vi.clearAllMocks(); root = await mkdtemp(path.join(tmpdir(), "ppt-image-jobs-test-")); vi.stubEnv("PPT_STORAGE_PATH", root);
  mocks.owner.mockResolvedValue(undefined); mocks.asset.mockResolvedValue(null);
  mocks.execute.mockImplementation(async () => Response.json({ imageUrl: "/ppt/api/assets/test/content" }));
});
afterEach(async () => { vi.unstubAllEnvs(); if (root.startsWith(path.join(tmpdir(), "ppt-image-jobs-test-"))) await rm(root, { recursive: true, force: true }); });
describe.skipIf(!process.env.PPT_DATABASE_URL?.startsWith("mysql:"))("durable image job receipts on MySQL", () => {
  it("atomically accepts concurrent duplicate submissions and executes only once", async () => {
    const id = randomUUID();
    const receipts = await Promise.all(Array.from({ length: 4 }, () => beginImageJob(user, form(), id)));
    expect(receipts.filter(item => item.created)).toHaveLength(1);
    await Promise.all(receipts.map(item => runImageJob(item.job, user, form())));
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(await getImageJob(user, id)).toMatchObject({ status: "succeeded", result: { imageUrl: "/ppt/api/assets/test/content" } });
  });
  it("rejects reused IDs with different payload and cannot query another user's receipt", async () => {
    const id = randomUUID(); await beginImageJob(user, form(), id);
    await expect(beginImageJob(user, form("different"), id)).rejects.toMatchObject({ status: 409 });
    await expect(getImageJob({ ...user, id: "another-user" }, id)).rejects.toMatchObject({ status: 404 });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("checks project ownership before accepting and on every query", async () => {
    const id = randomUUID(); await beginImageJob(user, form(), id);
    mocks.owner.mockRejectedValue(new Error("forbidden"));
    await expect(beginImageJob(user, form(), randomUUID())).rejects.toThrow("forbidden");
    await expect(getImageJob(user, id)).rejects.toThrow("forbidden");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("preserves an image checkpoint when settlement or response fails", async () => {
    mocks.execute.mockImplementation(async (_user, _form, _id, checkpoint) => { await checkpoint({ imageUrl: "/saved-image" }); throw new Error("settlement interrupted"); });
    const { job } = await beginImageJob(user, form(), randomUUID()); await runImageJob(job, user, form());
    expect(await getImageJob(user, job.jobId)).toMatchObject({ status: "succeeded", result: { imageUrl: "/saved-image" } });
  });
  it("does not mark an uncertain upstream timeout as permission to regenerate", async () => {
    mocks.execute.mockResolvedValue(Response.json({ error: "timeout" }, { status: 504 }));
    const { job } = await beginImageJob(user, form(), randomUUID()); await runImageJob(job, user, form());
    expect(await getImageJob(user, job.jobId)).toMatchObject({ status: "unknown" });
    await runImageJob(job, user, form()); expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
  it("recovers a saved asset after restart using owner-scoped read-only lookup", async () => {
    const { job } = await beginImageJob(user, form(), randomUUID());
    await getPrisma().imageGenerationJob.update({ where: { id: job.jobId }, data: { payload: JSON.parse(JSON.stringify({ ...job, processId: "old-process" })) } });
    const before = await getPrisma().imageGenerationJob.findUnique({ where: { id: job.jobId } });
    expect(await getImageJob(user, job.jobId)).toMatchObject({ status: "unknown" });
    mocks.asset.mockResolvedValue({ url: "/recovered-asset" });
    expect(await getImageJob(user, job.jobId)).toMatchObject({ status: "succeeded", result: { imageUrl: "/recovered-asset" } });
    expect(await getPrisma().imageGenerationJob.findUnique({ where: { id: job.jobId } })).toEqual(before);
    expect(mocks.asset).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: user.id }) }));
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
