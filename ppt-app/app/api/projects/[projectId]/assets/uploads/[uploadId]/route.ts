import { requireUser } from "@/src/server/auth/session";
import { createAssetFromFilePath, assertProjectOwner } from "@/src/server/assets/service";
import { abortChunkUpload, completeChunkUpload, expectedChunkBytes, getChunkUpload, storeUploadChunk } from "@/src/server/assets/chunkedUpload";
import { errorResponse, ValidationError } from "@/src/server/errors";

type Context = { params: Promise<{ projectId: string; uploadId: string }> };

async function routeContext(context: Context) {
  const user = await requireUser();
  const { projectId, uploadId } = await context.params;
  return { user, projectId, uploadId };
}

async function readBoundedChunk(request: Request, expectedSize: number) {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) !== expectedSize) throw new ValidationError("分片大小与上传计划不一致");
  if (!request.body) throw new ValidationError("分片内容不能为空");
  const output = new Uint8Array(expectedSize);
  const reader = request.body.getReader();
  let offset = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.byteLength > expectedSize) {
      await reader.cancel().catch(() => undefined);
      throw new ValidationError("分片内容超过允许大小");
    }
    output.set(value, offset);
    offset += value.byteLength;
  }
  if (offset !== expectedSize) throw new ValidationError("分片内容不完整");
  return output;
}

export async function PUT(request: Request, context: Context) {
  try {
    const { user, projectId, uploadId } = await routeContext(context);
    await assertProjectOwner(projectId, user.id);
    const partNumberHeader = request.headers.get("x-chunk-index");
    if (partNumberHeader === null || !/^\d+$/.test(partNumberHeader))
      throw new ValidationError("分片序号无效");
    const partNumber = Number(partNumberHeader);
    const checksum = String(request.headers.get("x-chunk-sha256") || "");
    const { session } = await getChunkUpload(uploadId, user.id, projectId);
    const bytes = await readBoundedChunk(request, expectedChunkBytes(session, partNumber));
    return Response.json(await storeUploadChunk({ uploadId, userId: user.id, projectId, partNumber, checksum, bytes }));
  } catch (error) { return errorResponse(error); }
}

export async function POST(_: Request, context: Context) {
  try {
    const { user, projectId, uploadId } = await routeContext(context);
    await assertProjectOwner(projectId, user.id);
    const asset = await completeChunkUpload(uploadId, user.id, projectId, (filePath, session) => createAssetFromFilePath({
      userId: user.id,
      projectId,
      filePath,
      fileName: session.fileName,
      mimeType: session.mimeType,
      size: session.totalSize,
      type: session.type,
    }));
    return Response.json({ asset }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(_: Request, context: Context) {
  try {
    const { user, projectId, uploadId } = await routeContext(context);
    await abortChunkUpload(uploadId, user.id, projectId);
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
