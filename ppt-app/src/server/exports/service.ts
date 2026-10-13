import { getPrisma } from "@/src/server/db/prisma";
import { createAsset } from "@/src/server/assets/service";
import { createVersion } from "@/src/server/versions/service";
import type { CloudProjectSnapshot } from "@/src/server/projects/types";

export async function saveGeneratedExport(input: { userId: string; projectId: string; file: File; pageCount: number; snapshot?: CloudProjectSnapshot; expectedRevision?: number }) {
  const version = await createVersion(input.userId, input.projectId, { label: `导出快照 · 修订 ${input.expectedRevision ?? ""}`, reason: "export", snapshot: input.snapshot, expectedRevision: input.expectedRevision });
  const asset = await createAsset({ userId: input.userId, projectId: input.projectId, file: input.file, type: "generated_ppt", metadata: { pageCount: input.pageCount, versionNumber: version.versionNumber, revision: input.expectedRevision } });
  const record = await getPrisma().exportRecord.create({ data: { projectId: input.projectId, assetId: asset.id, versionId: version.id, pageCount: input.pageCount } });
  await getPrisma().project.update({ where: { id: input.projectId }, data: { status: "exported" } });
  return { id: record.id, asset, version, pageCount: record.pageCount, createdAt: record.createdAt.toISOString() };
}
