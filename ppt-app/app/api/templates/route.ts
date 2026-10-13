import type { TemplateStatus } from "@/src/generated/prisma/enums";
import { requireUser } from "@/src/server/auth/session";
import { copyTemplate, listTemplates } from "@/src/server/library/templates";
import { errorResponse } from "@/src/server/errors";

export async function GET(request: Request) {
  try {
    const user = await requireUser(); const url = new URL(request.url);
    return Response.json(await listTemplates(user.id, { page: Number(url.searchParams.get("page") || 1), pageSize: Number(url.searchParams.get("pageSize") || 24), search: url.searchParams.get("search") || undefined, category: url.searchParams.get("category") || undefined, scope: url.searchParams.get("scope") || undefined, status: (url.searchParams.get("status") || undefined) as TemplateStatus | undefined, sort: url.searchParams.get("sort") || undefined }));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try { const user = await requireUser(); const body = await request.json(); return Response.json(await copyTemplate(user.id, body.templateId), { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
