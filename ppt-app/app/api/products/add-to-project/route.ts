import { requireUser } from "@/src/server/auth/session";
import { addLibraryProductsToProject } from "@/src/server/library/products";
import { errorResponse } from "@/src/server/errors";

export async function POST(request: Request) {
  try { const user = await requireUser(); return Response.json(await addLibraryProductsToProject(user.id, await request.json()), { status: 201 }); }
  catch (error) { return errorResponse(error); }
}
