/** Keep the server error identity across fetch and XHR upload paths. */
export class CloudApiError extends Error {
  constructor(message: string, readonly status = 0, readonly code?: string) {
    super(message);
    this.name = "CloudApiError";
  }
}

export function isProjectDeleted(error: unknown): error is CloudApiError {
  return error instanceof CloudApiError && error.status === 404 && error.code === "PROJECT_DELETED";
}

/** Never expose an HTML proxy page (or its JSON parser exception) to the user. */
export function parseCloudResponse<T>(text: string, status: number, action: string): T {
  let payload: Record<string, unknown> | undefined;
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) payload = value as Record<string, unknown>;
  } catch { /* Status still carries useful information when a proxy returns HTML. */ }
  const message = typeof payload?.error === "string" ? payload.error : undefined;
  const code = typeof payload?.code === "string" ? payload.code : undefined;
  if (status === 401) throw new CloudApiError(message || "登录已失效，请重新登录；当前资料请保留", status, code);
  if (status === 403) throw new CloudApiError(message || "没有操作权限；当前资料请保留", status, code);
  if (status < 200 || status >= 300 || !payload) {
    const fallback = status === 413 ? "请求内容过大，当前资料已保留" : `${action}未收到有效确认（HTTP ${status || "未知"}），请保留当前资料后重试`;
    throw new CloudApiError(message || fallback, status, code || (!payload ? "INVALID_RESPONSE" : undefined));
  }
  return payload as T;
}

export async function readCloudResponse<T>(response: Response, action: string): Promise<T> {
  return parseCloudResponse<T>(await response.text(), response.status, action);
}

export function isUncertainResponse(error: unknown) {
  if (error instanceof CloudApiError) {
    if ([401, 403, 404, 409, 413, 422].includes(error.status)) return false;
    return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500 || error.code === "INVALID_RESPONSE";
  }
  return error instanceof TypeError || (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name));
}

/** Queries only. An uncertain mutation must not be submitted again by this loop. */
export async function recoverCloudResult<T>(query: () => Promise<T | undefined>, action: string, progress?: (message: string) => void): Promise<T> {
  const start = Date.now();
  for (const delay of [0, 2000, 5000, 10000]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    progress?.(`${action}连接中断，正在核对服务器结果（已等待 ${Math.floor((Date.now() - start) / 1000)} 秒）…`);
    try { const result = await query(); if (result !== undefined) return result; }
    catch (error) { if (!isUncertainResponse(error)) throw error; }
  }
  throw new CloudApiError(`${action}结果暂未确认，当前资料已保留。请保留页面后重试，将先核对已有进度`, 0, "RESULT_UNKNOWN");
}
