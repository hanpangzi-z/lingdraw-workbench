import { normalizeProductsWithAI } from "@/src/lib/ai/server";
import { requireUser } from "@/src/server/auth/session";
import { errorResponse } from "@/src/server/errors";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!Array.isArray(body.products) || !Array.isArray(body.categoryCandidates)) {
      return Response.json({ error: "商品标准化请求格式不正确" }, { status: 400 });
    }
    if (body.products.length > 20) return Response.json({ error: "单批最多处理 20 个商品" }, { status: 400 });
    if (body.requestId !== undefined && (typeof body.requestId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(body.requestId))) {
      return Response.json({ error: "AI 请求 ID 格式不正确" }, { status: 400 });
    }
    const user = process.env.AI_MOCK_MODE?.toLowerCase() === "true" ? undefined : await requireUser();
    return Response.json(await normalizeProductsWithAI(body as Parameters<typeof normalizeProductsWithAI>[0], user));
  } catch (error) {
    console.error("AI product normalization failed", error);
    return errorResponse(error);
  }
}
