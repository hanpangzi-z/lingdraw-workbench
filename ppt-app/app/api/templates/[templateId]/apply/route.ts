import { requireUser } from "@/src/server/auth/session";
import { applyTemplateToProject } from "@/src/server/library/templates";
import { errorResponse } from "@/src/server/errors";
type Context = { params: Promise<{ templateId: string }> };

export async function POST(request: Request, context: Context) {
  try { const user = await requireUser(); const { templateId } = await context.params; const body = await request.json(); return Response.json(await applyTemplateToProject(user.id, templateId, body.projectId)); }
  catch (error) { return errorResponse(error); }
}
