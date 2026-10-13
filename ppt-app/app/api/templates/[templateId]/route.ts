import { requireUser } from "@/src/server/auth/session";
import { getTemplateDetail, toggleTemplateFavorite, updateTemplate } from "@/src/server/library/templates";
import { errorResponse } from "@/src/server/errors";
type Context = { params: Promise<{ templateId: string }> };

export async function GET(_request: Request, context: Context) {
  try { const user = await requireUser(); const { templateId } = await context.params; return Response.json(await getTemplateDetail(user.id, templateId)); }
  catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request, context: Context) {
  try { const user = await requireUser(); const { templateId } = await context.params; return Response.json(await updateTemplate(user.id, templateId, await request.json())); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  try { const user = await requireUser(); const { templateId } = await context.params; const body = await request.json(); if (body.action !== "favorite") throw new Error("无效操作"); return Response.json(await toggleTemplateFavorite(user.id, templateId)); }
  catch (error) { return errorResponse(error); }
}
