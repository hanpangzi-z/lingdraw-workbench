export const PPT_BASE_PATH = "/ppt";

export function withBasePath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || path === PPT_BASE_PATH || path.startsWith(`${PPT_BASE_PATH}/`)) return path;
  return `${PPT_BASE_PATH}${path}`;
}

function notifyAuthRequired() {
  if (typeof window === "undefined") return;
  if (window.parent !== window) window.parent.postMessage({ type: "ppt:auth-required" }, window.location.origin);
  else window.location.replace("/login");
}

const observedAuthResponses = new WeakSet<Response>();

export function isPptHostResponseUrl(responseUrl: string, origin: string) {
  if (!responseUrl) return true;
  try {
    const url = new URL(responseUrl, origin);
    return url.origin === origin && (url.pathname === PPT_BASE_PATH || url.pathname.startsWith(`${PPT_BASE_PATH}/`));
  } catch {
    return false;
  }
}

export async function isHostAuthFailure(response: Response, origin = typeof window === "undefined" ? "" : window.location.origin) {
  if (origin && !isPptHostResponseUrl(response.url, origin)) return false;
  if (response.status === 401) return true;
  if (response.status !== 403) return false;
  try {
    const payload = await response.clone().json() as { code?: unknown; detail?: { code?: unknown } };
    const code = typeof payload.code === "string" ? payload.code : typeof payload.detail?.code === "string" ? payload.detail.code : "";
    return code === "account_disabled" || code === "account_pending";
  } catch {
    return false;
  }
}

export async function observeHostAuthFailure(response: Response) {
  if (observedAuthResponses.has(response)) return false;
  observedAuthResponses.add(response);
  const failure = await isHostAuthFailure(response);
  if (failure) notifyAuthRequired();
  return failure;
}

export async function pptFetch(input: RequestInfo | URL, init?: RequestInit) {
  const resolved = typeof input === "string" ? withBasePath(input) : input;
  const response = await fetch(resolved, init);
  await observeHostAuthFailure(response);
  return response;
}
