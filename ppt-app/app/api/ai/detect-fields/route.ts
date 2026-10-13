import { detectFieldsWithAI } from "@/src/lib/ai/server";
import { requireUser } from "@/src/server/auth/session";
import { errorResponse } from "@/src/server/errors";

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!Array.isArray(body.headers) || !Array.isArray(body.unmatchedTargets) || !Array.isArray(body.sampleRows)) {
      return Response.json({ error: "字段识别请求格式不正确" }, { status: 400 });
    }
    if (body.requestId !== undefined && (typeof body.requestId !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(body.requestId))) {
      return Response.json({ error: "AI 请求 ID 格式不正确" }, { status: 400 });
    }
    const user = process.env.AI_MOCK_MODE?.toLowerCase() === "true" ? undefined : await requireUser();
    return Response.json(await detectFieldsWithAI(body as Parameters<typeof detectFieldsWithAI>[0], user));
  } catch (error) {
    console.error("AI field detection failed", error);
    return errorResponse(error);
  }
}
