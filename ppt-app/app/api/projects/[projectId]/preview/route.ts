import { requireUser } from "@/src/server/auth/session";
import { getProject } from "@/src/server/projects/service";
import { createProjectPreview } from "@/src/lib/cloud/projectPreview";
import { errorResponse } from "@/src/server/errors";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireUser();
    const project = await getProject(user.id, (await context.params).projectId, true, false);
    return Response.json({ ...createProjectPreview(project.snapshot), revision: project.revision }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return errorResponse(error); }
}
