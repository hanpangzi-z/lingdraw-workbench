import { requireUser } from "@/src/server/auth/session";
import { deleteAsset, getAssetReferenceSummary } from "@/src/server/assets/service";
import { errorResponse } from "@/src/server/errors";
type Context = { params: Promise<{ assetId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { assetId } = await context.params;
    return Response.json(await getAssetReferenceSummary(assetId, user.id));
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { assetId } = await context.params;
    await deleteAsset(user.id, assetId);
    return new Response(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
