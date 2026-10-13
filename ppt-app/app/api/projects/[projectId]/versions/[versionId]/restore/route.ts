import { requireUser } from "@/src/server/auth/session";
import { restoreVersion } from "@/src/server/versions/service";
import { errorResponse } from "@/src/server/errors";

type Context = { params: Promise<{ projectId: string; versionId: string }> };

export async function POST(_: Request, context: Context) {
  try { const user = await requireUser(); const { projectId, versionId } = await context.params; return Response.json(await restoreVersion(user.id, projectId, versionId)); }
  catch (error) { return errorResponse(error); }
}
