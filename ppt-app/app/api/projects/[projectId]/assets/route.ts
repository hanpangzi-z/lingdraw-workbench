import type { AssetType } from "@/src/generated/prisma/enums";
import { requireUser } from "@/src/server/auth/session";
import { createAsset, findUploadedProjectAsset, listProjectAssets } from "@/src/server/assets/service";
import { CHUNK_UPLOAD_BYTES } from "@/src/server/assets/config";
import { errorResponse, ValidationError } from "@/src/server/errors";

type Context = { params: Promise<{ projectId: string }> };
const allowedTypes = new Set<AssetType>(["source_file", "product_image", "logo", "generated_ppt", "thumbnail"]);

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireUser(); const { projectId } = await context.params;
    const url = new URL(request.url); const checksum = url.searchParams.get("checksum");
    if (checksum) {
      const type = url.searchParams.get("type") as AssetType;
      if (!allowedTypes.has(type)) throw new ValidationError("不支持的文件类型");
      return Response.json({ asset: await findUploadedProjectAsset(projectId, user.id, checksum, type) });
    }
    return Response.json({ items: await listProjectAssets(projectId, user.id) });
  }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const declaredSize = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > CHUNK_UPLOAD_BYTES + 1024 * 1024)
      throw new ValidationError("超过 5MB 的文件必须使用分片上传");
    const form = await request.formData();
    const file = form.get("file");
    const type = String(form.get("type") || "source_file") as AssetType;
    if (!(file instanceof File)) throw new ValidationError("请选择文件");
    if (!allowedTypes.has(type)) throw new ValidationError("不支持的文件类型");
    if (file.size > CHUNK_UPLOAD_BYTES)
      throw new ValidationError("超过 5MB 的文件必须使用分片上传");
    const asset = await createAsset({ userId: user.id, projectId: (await context.params).projectId, file, type });
    return Response.json({ asset }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
