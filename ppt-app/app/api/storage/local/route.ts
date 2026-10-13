import { requireUser } from "@/src/server/auth/session";
import { getPrisma } from "@/src/server/db/prisma";
import { getStorageProvider } from "@/src/lib/storage";
import { errorResponse, NotFoundError } from "@/src/server/errors";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const key = new URL(request.url).searchParams.get("key");
    if (!key) throw new NotFoundError("文件不存在");
    const asset = await getPrisma().asset.findUnique({ where: { storageKey: key } });
    if (!asset || (asset.userId !== user.id && !asset.isSystem) || asset.deletedAt) throw new NotFoundError("文件不存在");
    const object = await getStorageProvider().getObject(key);
    return new Response(object.data as BodyInit, { headers: { "Content-Type": asset.mimeType, "Content-Length": String(object.size ?? asset.size), "Cache-Control": "private, max-age=3600" } });
  } catch (error) { return errorResponse(error); }
}
