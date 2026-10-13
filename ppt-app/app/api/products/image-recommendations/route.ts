import { requireUser } from "@/src/server/auth/session";
import { recommendLibraryProductImages } from "@/src/server/library/products";
import { errorResponse, ValidationError } from "@/src/server/errors";

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json() as { skus?: string[] };
    if (!Array.isArray(body.skus)) throw new ValidationError("skus 必须是字符串数组");
    return Response.json(await recommendLibraryProductImages(user.id, body.skus));
  } catch (error) {
    return errorResponse(error);
  }
}
