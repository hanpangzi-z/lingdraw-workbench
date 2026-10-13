import { requireUser } from "@/src/server/auth/session";
import { getAssetForUser } from "@/src/server/assets/service";
import { getStorageProvider } from "@/src/lib/storage";
import { errorResponse } from "@/src/server/errors";

type Context = { params: Promise<{ assetId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const asset = await getAssetForUser((await context.params).assetId, user.id);
    const storage = getStorageProvider();
    if (process.env.STORAGE_PROVIDER === "s3") return Response.redirect(await storage.getUrl(asset.storageKey, 3600));
    const object = await storage.getObject(asset.storageKey);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(object.data as BodyInit, {
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(object.size ?? asset.size),
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
      },
    });
  } catch (error) { return errorResponse(error); }
}
