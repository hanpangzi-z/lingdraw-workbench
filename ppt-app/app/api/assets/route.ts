import type { AssetType } from "@/src/generated/prisma/enums";
import { requireUser } from "@/src/server/auth/session";
import { listUserAssets } from "@/src/server/assets/service";
import { errorResponse } from "@/src/server/errors";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    return Response.json(await listUserAssets(user.id, {
      page: Number(url.searchParams.get("page") || 1),
      pageSize: Number(url.searchParams.get("pageSize") || 30),
      search: url.searchParams.get("search") || undefined,
      type: (url.searchParams.get("type") || undefined) as AssetType | undefined,
    }));
  } catch (error) { return errorResponse(error); }
}
