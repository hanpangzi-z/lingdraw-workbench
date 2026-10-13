import { requireUser } from "@/src/server/auth/session";
import { lingDrawInternalHeaders, lingDrawInternalUrl } from "@/src/server/ai/internalBridge";
import { AIServiceError, errorResponse } from "@/src/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const response = await fetch(lingDrawInternalUrl("/api/ppt/internal/ai/image-models"), {
      headers: lingDrawInternalHeaders(user),
      cache: "no-store",
    });
    if (!response.ok) throw new AIServiceError("图片模型加载失败，请重试。", 502);
    const payload = await response.json() as { providers?: unknown };
    return Response.json({ providers: Array.isArray(payload.providers) ? payload.providers : [] });
  } catch (error) {
    return errorResponse(error);
  }
}
