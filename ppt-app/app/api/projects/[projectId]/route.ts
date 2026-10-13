import { requireUser } from "@/src/server/auth/session";
import { duplicateProject, getProject, permanentlyDeleteProject, renameProject, restoreProject, saveProject, softDeleteProject } from "@/src/server/projects/service";
import { errorResponse, ValidationError } from "@/src/server/errors";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_: Request, context: Context) {
  try { const user = await requireUser(); return Response.json(await getProject(user.id, (await context.params).projectId)); }
  catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { projectId } = await context.params;
    const body = await request.json();
    return Response.json(await saveProject(user.id, projectId, body.expectedRevision, body.snapshot));
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { projectId } = await context.params;
    const body = await request.json();
    if (body.action === "rename") return Response.json(await renameProject(user.id, projectId, body.name));
    if (body.action === "restore") return Response.json(await restoreProject(user.id, projectId));
    if (body.action === "duplicate") return Response.json(await duplicateProject(user.id, projectId), { status: 201 });
    throw new ValidationError("不支持的项目操作");
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { projectId } = await context.params;
    const permanent = new URL(request.url).searchParams.get("permanent") === "true";
    if (permanent) await permanentlyDeleteProject(user.id, projectId); else await softDeleteProject(user.id, projectId);
    return new Response(null, { status: 204 });
  } catch (error) { return errorResponse(error); }
}
