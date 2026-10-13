import type { GlobalProductStatus } from "@/src/generated/prisma/enums";
import { requireUser } from "@/src/server/auth/session";
import { batchUpdateGlobalProducts, createGlobalProduct, listGlobalProducts } from "@/src/server/library/products";
import { errorResponse } from "@/src/server/errors";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    return Response.json(await listGlobalProducts(user.id, {
      page: Number(url.searchParams.get("page") || 1), pageSize: Number(url.searchParams.get("pageSize") || 30), search: url.searchParams.get("search") || undefined,
      categoryId: url.searchParams.get("categoryId") || undefined, brandId: url.searchParams.get("brandId") || undefined,
      status: (url.searchParams.get("status") || undefined) as GlobalProductStatus | undefined, deliveryProfileId: url.searchParams.get("deliveryProfileId") || undefined,
      missingImage: url.searchParams.get("missingImage") === "true", missingPrice: url.searchParams.get("missingPrice") === "true", updatedFrom: url.searchParams.get("updatedFrom") || undefined, sort: url.searchParams.get("sort") || undefined,
    }));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try { const user = await requireUser(); return Response.json(await createGlobalProduct(user.id, await request.json()), { status: 201 }); }
  catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  try { const user = await requireUser(); return Response.json(await batchUpdateGlobalProducts(user.id, await request.json())); }
  catch (error) { return errorResponse(error); }
}
