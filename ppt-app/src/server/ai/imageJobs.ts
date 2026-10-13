import { createHash, randomUUID } from "node:crypto";
import type { LingDrawUser } from "@/src/server/auth/session";
import { assertProjectOwner, serializeAsset } from "@/src/server/assets/service";
import { getPrisma } from "@/src/server/db/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/src/server/errors";
import { executeImageGeneration, validateImageGenerationForm } from "./imageGeneration";

export type ImageJobState = "queued" | "generating" | "persisting" | "succeeded" | "failed" | "unknown";
export type ImageJob = { version: 1; jobId: string; userId: string; projectId?: string; fingerprint: string; processId: string; status: ImageJobState; createdAt: number; updatedAt: number; result?: Record<string, unknown>; error?: string };
const processState = globalThis as unknown as { pptImageJobProcess?: string };
const processId = processState.pptImageJobProcess ||= randomUUID();
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validateJobId(jobId: string) {
  if (!JOB_ID.test(jobId)) throw new ValidationError("绘图任务编号无效");
  return jobId.toLowerCase();
}
async function readJob(userId: string, jobId: string) {
  const row = await getPrisma().imageGenerationJob.findFirst({ where: { id: validateJobId(jobId), userId } });
  if (!row) throw new NotFoundError("绘图任务尚未收到或不存在");
  return row.payload as unknown as ImageJob;
}
async function saveJob(job: ImageJob) {
  const updated = await getPrisma().imageGenerationJob.updateMany({
    where: { id: validateJobId(job.jobId), userId: job.userId },
    data: { payload: JSON.parse(JSON.stringify(job)), updatedAt: BigInt(job.updatedAt) },
  });
  if (!updated.count) throw new NotFoundError("绘图任务不存在");
}
export async function beginImageJob(user: LingDrawUser, form: FormData, jobId: string) {
  const input = await validateImageGenerationForm(form, user);
  const digest = createHash("sha256").update(JSON.stringify({ ...input, images: undefined }));
  for (const image of input.images) digest.update(JSON.stringify([image.type, image.size, createHash("sha256").update(new Uint8Array(await image.arrayBuffer())).digest("hex")]));
  const fingerprint = digest.digest("hex");
  validateJobId(jobId);
  const job: ImageJob = { version: 1, jobId: jobId.toLowerCase(), userId: user.id, projectId: input.projectId, fingerprint, processId, status: "queued", createdAt: Date.now(), updatedAt: Date.now() };
  // Publish a complete receipt atomically. A duplicate POST never starts a second run.
  try {
    await getPrisma().imageGenerationJob.create({ data: { id: job.jobId, userId: user.id, payload: JSON.parse(JSON.stringify(job)), updatedAt: BigInt(job.updatedAt) } });
    return { job, created: true };
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const existing = await readJob(user.id, jobId);
    if (existing.fingerprint !== fingerprint) throw new ConflictError("同一绘图任务编号不能提交不同内容，请先查询原任务结果");
    return { job: existing, created: false };
  }
}

export async function runImageJob(job: ImageJob, user: LingDrawUser, form: FormData) {
  // Permanent claim: if the process dies, queries report uncertainty; never re-generate.
  const claim = await getPrisma().imageGenerationJob.updateMany({ where: { id: job.jobId, userId: user.id, started: false }, data: { started: true } });
  if (!claim.count) return;
  try {
    job.status = "generating"; job.updatedAt = Date.now(); await saveJob(job);
    const response = await executeImageGeneration(user, form, job.jobId, async result => {
      job.result = result; job.status = "persisting"; job.updatedAt = Date.now(); await saveJob(job);
    });
    const payload = await response.json() as Record<string, unknown>;
    if (response.ok) { job.result = payload; job.status = "succeeded"; }
    else if (job.result) job.status = "succeeded"; // A saved image is not a failed generation.
    else {
      job.status = response.status >= 500 || response.status === 408 ? "unknown" : "failed";
      job.error = job.status === "unknown" ? "上游结果暂时无法确认，请继续查询原任务，不要重复生成" : typeof payload.error === "string" ? payload.error : "绘图失败，请检查模型后重试";
    }
  } catch {
    job.status = job.result ? "succeeded" : "unknown";
    job.error = job.result ? undefined : "任务状态暂时无法确认，请查询原任务；系统没有重新生成";
  }
  job.updatedAt = Date.now();
  await saveJob(job).catch(() => console.error("[PPT Image Job] receipt save failed", { jobId: job.jobId }));
}

export async function getImageJob(user: LingDrawUser, jobId: string) {
  const job = await readJob(user.id, jobId);
  if (job.projectId) await assertProjectOwner(job.projectId, user.id);
  if (!job.result && job.status !== "failed" && (job.processId !== processId || Date.now() - job.updatedAt > 10 * 60_000 || job.status === "unknown")) {
    // A container restart can happen after Asset persisted but before receipt update.
    const asset = await getPrisma().asset.findFirst({ where: { userId: user.id, deletedAt: null, metadata: { path: "$.requestId", equals: job.jobId } } });
    if (asset) { job.result = { imageUrl: serializeAsset(asset).url }; job.status = "succeeded"; }
    else { job.status = "unknown"; job.error = "连接或服务曾中断，结果待确认；请继续查询原任务，不要重复生成"; }
  }
  return publicImageJob(job);
}
export function publicImageJob(job: ImageJob) {
  return { jobId: job.jobId, status: job.result ? "succeeded" : job.status, createdAt: job.createdAt, updatedAt: job.updatedAt, ...(job.result ? { result: job.result } : {}), ...(job.error ? { error: job.error } : {}) };
}
