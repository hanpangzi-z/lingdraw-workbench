import { requireUser } from "@/src/server/auth/session";
import { applyProjectProductSync, getProjectProductSync } from "@/src/server/library/products";
import { errorResponse } from "@/src/server/errors";
type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Context) {
  try { const user = await requireUser(); const { projectId } = await context.params; return Response.json({ items: await getProjectProductSync(user.id, projectId) }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try { const user = await requireUser(); const { projectId } = await context.params; return Response.json(await applyProjectProductSync(user.id, projectId, await request.json())); }
  catch (error) { return errorResponse(error); }
}
