import { requireUser } from "@/src/server/auth/session";
import { createProductResource, listProductResources, updateProductResource } from "@/src/server/library/productResources";
import { errorResponse } from "@/src/server/errors";

export async function GET() {
  try { const user = await requireUser(); return Response.json(await listProductResources(user.id)); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try { const user = await requireUser(); return Response.json(await createProductResource(user.id, await request.json()), { status: 201 }); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try { const user = await requireUser(); return Response.json(await updateProductResource(user.id, await request.json())); }
  catch (error) { return errorResponse(error); }
}
