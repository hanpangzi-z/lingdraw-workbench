import { requireUser } from "@/src/server/auth/session";
import { updateTheme } from "@/src/server/library/templates";
import { errorResponse } from "@/src/server/errors";
type Context = { params: Promise<{ themeId: string }> };

export async function PUT(request: Request, context: Context) {
  try { const user = await requireUser(); const { themeId } = await context.params; return Response.json(await updateTheme(user.id, themeId, await request.json())); }
  catch (error) { return errorResponse(error); }
}
