import { requireUser } from "@/src/server/auth/session";
import { createVersion, listVersions } from "@/src/server/versions/service";
import { errorResponse } from "@/src/server/errors";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_: Request, context: Context) {
  try { const user = await requireUser(); return Response.json({ items: await listVersions(user.id, (await context.params).projectId) }); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, context: Context) {
  try { const user = await requireUser(); return Response.json(await createVersion(user.id, (await context.params).projectId, await request.json()), { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
