import { requireUser } from "@/src/server/auth/session";
import { saveProjectProductToLibrary } from "@/src/server/library/products";
import { errorResponse } from "@/src/server/errors";
type Context = { params: Promise<{ projectId: string }> };

export async function POST(request: Request, context: Context) {
  try { const user = await requireUser(); const { projectId } = await context.params; return Response.json(await saveProjectProductToLibrary(user.id, projectId, await request.json()), { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
