import { requireUser } from "@/src/server/auth/session";
import { createTheme, listThemes } from "@/src/server/library/templates";
import { errorResponse } from "@/src/server/errors";

export async function GET() {
  try { const user = await requireUser(); return Response.json(await listThemes(user.id)); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try { const user = await requireUser(); return Response.json(await createTheme(user.id, await request.json()), { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
