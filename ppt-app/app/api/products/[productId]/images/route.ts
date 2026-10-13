import { requireUser } from "@/src/server/auth/session";
import { addProductImage, updateProductImages } from "@/src/server/library/products";
import { errorResponse, ValidationError } from "@/src/server/errors";
type Context = { params: Promise<{ productId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireUser(); const { productId } = await context.params; const form = await request.formData(); const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("请选择图片");
    return Response.json(await addProductImage(user.id, productId, file), { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, context: Context) {
  try { const user = await requireUser(); const { productId } = await context.params; return Response.json(await updateProductImages(user.id, productId, await request.json())); }
  catch (error) { return errorResponse(error); }
}
