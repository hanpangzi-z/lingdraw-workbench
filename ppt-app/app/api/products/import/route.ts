import { requireUser } from "@/src/server/auth/session";
import { importGlobalProducts } from "@/src/server/library/products";
import { errorResponse } from "@/src/server/errors";

export async function POST(request: Request) {
  try { const user = await requireUser(); return Response.json(await importGlobalProducts(user.id, await request.json())); }
  catch (error) { return errorResponse(error); }
}
