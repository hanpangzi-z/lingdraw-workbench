import type { AssetType } from "@/src/generated/prisma/enums";
import { requireUser } from "@/src/server/auth/session";
import { assertProjectOwner } from "@/src/server/assets/service";
import { beginChunkUpload } from "@/src/server/assets/chunkedUpload";
import { ASSET_TYPE_TO_ROLE } from "@/src/server/assets/config";
import { errorResponse, ValidationError } from "@/src/server/errors";

type Context = { params: Promise<{ projectId: string }> };
const allowedTypes = new Set<AssetType>(Object.keys(ASSET_TYPE_TO_ROLE) as AssetType[]);

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const projectId = (await context.params).projectId;
    await assertProjectOwner(projectId, user.id);
    const payload = await request.json().catch(() => { throw new ValidationError("上传参数格式不正确"); }) as Record<string, unknown>;
    const type = String(payload.type || "source_file") as AssetType;
    if (!allowedTypes.has(type)) throw new ValidationError("不支持的文件类型");
    const upload = await beginChunkUpload({
      userId: user.id,
      projectId,
      fileName: String(payload.fileName || ""),
      mimeType: String(payload.mimeType || "application/octet-stream"),
      type,
      totalSize: Number(payload.size),
    });
    return Response.json({
      uploadId: upload.uploadId,
      chunkSize: upload.chunkSize,
      chunkCount: upload.chunkCount,
    }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
