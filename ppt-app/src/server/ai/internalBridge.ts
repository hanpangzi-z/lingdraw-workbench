import type { LingDrawUser } from "@/src/server/auth/session";
import { AIServiceError } from "@/src/server/errors";

export function lingDrawInternalUrl(path: string) {
  const base = process.env.PPT_INTERNAL_URL?.trim().replace(/\/+$/, "");
  if (!base) throw new Error("PPT_INTERNAL_URL 未配置");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function lingDrawInternalHeaders(user: LingDrawUser) {
  const token = process.env.PPT_INTERNAL_TOKEN;
  if (!token) throw new Error("PPT_INTERNAL_TOKEN 未配置");
  return {
    "x-ppt-internal-token": token,
    "x-lingdraw-user-id": user.externalUserId,
    "x-lingdraw-username": encodeURIComponent(user.username),
    "x-lingdraw-display-name": encodeURIComponent(user.name || user.username),
    "x-lingdraw-role": user.role,
  };
}

export async function bridgeError(response: Response) {
  const text = await response.text();
  let code: string | undefined;
  try {
    const payload = JSON.parse(text) as { code?: unknown; detail?: { code?: unknown } };
    const candidate = typeof payload.code === "string" ? payload.code : typeof payload.detail?.code === "string" ? payload.detail.code : undefined;
    if (candidate && /^[a-z0-9_.-]{1,100}$/i.test(candidate)) code = candidate;
  } catch { /* The public response is intentionally status-only. */ }
  console.warn("[LingDraw AI] upstream request failed", { status: response.status, ...(code ? { code } : {}) });
  if (response.status === 400 || response.status === 422) return "AI 输入无法处理，请检查资料后重试";
  if (response.status === 401 || response.status === 403) return "灵绘 AI 身份校验失败，请重新登录";
  if (response.status === 409) return "AI 请求状态冲突，请刷新后重试";
  if (response.status === 413) return "AI 输入文件过大";
  if (response.status === 429) return "AI 服务额度不足或请求过于频繁，请稍后重试";
  if (response.status === 504) return "灵绘 AI 服务响应超时，请重试";
  return `灵绘 AI 服务暂时不可用（HTTP ${response.status}）`;
}

interface ImageSettlementResponse {
  ok?: boolean;
  requestId?: string;
  status?: "succeeded" | "failed";
  chargedPoints?: number;
  refundedPoints?: number;
  idempotent?: boolean;
}

export async function settleLingDrawImage(user: LingDrawUser, input: { requestId: string; success: boolean; error?: string }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(lingDrawInternalUrl("/api/ppt/internal/ai/image/settle"), {
      method: "POST",
      headers: { ...lingDrawInternalHeaders(user), "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: input.requestId, success: input.success, ...(input.error ? { error: input.error.slice(0, 1_000) } : {}) }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new AIServiceError(await bridgeError(response), response.status === 409 ? 409 : 502);
    const payload = await response.json() as ImageSettlementResponse;
    const expectedStatus = input.success ? "succeeded" : "failed";
    if (payload.ok !== true || payload.requestId !== input.requestId || payload.status !== expectedStatus) {
      throw new AIServiceError("灵绘 AI 图片结算返回格式不正确");
    }
    return payload as Required<Pick<ImageSettlementResponse, "ok" | "requestId" | "status">> & ImageSettlementResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new AIServiceError("灵绘 AI 图片结算超时", 504);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function settleLingDrawImageWithRetry(
  user: LingDrawUser,
  input: { requestId: string; success: boolean; error?: string },
  attempts = 2,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    try {
      return await settleLingDrawImage(user, input);
    } catch (error) {
      lastError = error;
      console.warn("[LingDraw AI] image settlement attempt failed", { requestId: input.requestId, attempt: attempt + 1 });
    }
  }
  throw lastError;
}
