import type { Prisma } from "@/src/generated/prisma/client";
import { getPrisma } from "@/src/server/db/prisma";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/src/server/errors";
import { getProject, saveProject } from "@/src/server/projects/service";
import { compactVersionSnapshot, hydrateVersionSnapshot } from "@/src/server/projects/snapshot";
import type { CloudProjectSnapshot } from "@/src/server/projects/types";

const cleanJson = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export async function listVersions(userId: string, projectId: string) {
  const project = await getPrisma().project.findUnique({ where: { id: projectId }, select: { userId: true } });
  if (!project) throw new NotFoundError("项目不存在");
  if (project.userId !== userId) throw new ForbiddenError();
  const versions = await getPrisma().projectVersion.findMany({
    where: { projectId }, orderBy: { versionNumber: "desc" },
    select: { id: true, versionNumber: true, label: true, reason: true, createdAt: true, createdBy: { select: { name: true, email: true } } },
  });
  return versions.map((version) => ({ ...version, createdAt: version.createdAt.toISOString() }));
}

export async function createVersion(userId: string, projectId: string, input: { label?: string; reason?: string; snapshot?: CloudProjectSnapshot; expectedRevision?: number } = {}) {
  if (input.expectedRevision !== undefined && (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1)) throw new ValidationError("缺少有效的已保存修订号");
  const detail = input.snapshot ? await getPrisma().project.findUnique({ where: { id: projectId }, select: { userId: true } }) : await getProject(userId, projectId);
  if (!detail) throw new NotFoundError("项目不存在");
  if ("userId" in detail && detail.userId !== userId) throw new ForbiddenError();
  const snapshot = input.snapshot ?? ("snapshot" in detail ? detail.snapshot : undefined);
  if (!snapshot) throw new NotFoundError("项目快照不存在");
  return getPrisma().$transaction(async (tx) => {
    if (input.expectedRevision !== undefined) {
      // CAS also locks the project row, serializing version allocation with saves.
      const locked = await tx.project.updateMany({ where: { id: projectId, userId, deletedAt: null, revision: input.expectedRevision }, data: { revision: input.expectedRevision } });
      if (locked.count !== 1) throw new ConflictError("项目修订号已变化，未建立版本或归档；请重新保存后重试");
    }
    const latest = await tx.projectVersion.aggregate({ where: { projectId }, _max: { versionNumber: true } });
    const versionNumber = (latest._max.versionNumber ?? 0) + 1;
    const created = await tx.projectVersion.create({
      data: { projectId, versionNumber, snapshot: cleanJson(compactVersionSnapshot(snapshot)) as unknown as Prisma.InputJsonValue, label: input.label?.trim() || `v${versionNumber}`, reason: input.reason, createdById: userId },
    });
    return { id: created.id, versionNumber, label: created.label, reason: created.reason, createdAt: created.createdAt.toISOString() };
  });
}

export async function restoreVersion(userId: string, projectId: string, versionId: string) {
  const [current, version] = await Promise.all([
    getProject(userId, projectId),
    getPrisma().projectVersion.findUnique({ where: { id: versionId }, include: { project: { select: { userId: true } } } }),
  ]);
  if (!version || version.projectId !== projectId) throw new NotFoundError("版本不存在");
  if (version.project.userId !== userId) throw new ForbiddenError();
  await createVersion(userId, projectId, { label: "恢复前自动保存", reason: `恢复到 v${version.versionNumber} 前`, snapshot: current.snapshot });
  const snapshot = hydrateVersionSnapshot(version.snapshot as unknown as CloudProjectSnapshot);
  const saved = await saveProject(userId, projectId, current.revision, snapshot);
  return { ...saved, snapshot, restoredVersion: version.versionNumber };
}
