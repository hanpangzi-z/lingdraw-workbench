import { requireUser } from "@/src/server/auth/session";
import { getGlobalProduct, updateGlobalProduct } from "@/src/server/library/products";
import { errorResponse } from "@/src/server/errors";
type Context = { params: Promise<{ productId: string }> };

export async function GET(_request: Request, context: Context) {
  try { const user = await requireUser(); const { productId } = await context.params; return Response.json(await getGlobalProduct(user.id, productId)); }
  catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request, context: Context) {
  try { const user = await requireUser(); const { productId } = await context.params; return Response.json(await updateGlobalProduct(user.id, productId, await request.json())); }
  catch (error) { return errorResponse(error); }
}

export async function DELETE(_request: Request, context: Context) {
  try { const user = await requireUser(); const { productId } = await context.params; return Response.json(await updateGlobalProduct(user.id, productId, { status: "archived" }, "归档商品")); }
  catch (error) { return errorResponse(error); }
}
