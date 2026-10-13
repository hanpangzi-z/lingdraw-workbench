import { createHash, timingSafeEqual } from "node:crypto";

export const PROXY_IDENTITY_HEADERS = {
  token: "x-ppt-internal-token",
  externalUserId: "x-lingdraw-user-id",
  username: "x-lingdraw-username",
  displayName: "x-lingdraw-display-name",
  role: "x-lingdraw-role",
} as const;

export interface ProxyIdentity {
  externalUserId: string;
  username: string;
  displayName: string;
  role: string;
}

function decodeHeader(value: string | null) {
  if (!value) return "";
  try { return decodeURIComponent(value).trim(); }
  catch { return value.trim(); }
}

export function isTrustedProxyToken(actual: string | null, expected = process.env.PPT_INTERNAL_TOKEN) {
  if (!actual || !expected) return false;
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

export function identityFromHeaders(requestHeaders: Headers): ProxyIdentity | undefined {
  if (!isTrustedProxyToken(requestHeaders.get(PROXY_IDENTITY_HEADERS.token))) return undefined;
  const externalUserId = decodeHeader(requestHeaders.get(PROXY_IDENTITY_HEADERS.externalUserId));
  const username = decodeHeader(requestHeaders.get(PROXY_IDENTITY_HEADERS.username));
  if (!externalUserId || externalUserId.length > 512 || !username || username.length > 320) return undefined;
  return {
    externalUserId,
    username,
    displayName: (decodeHeader(requestHeaders.get(PROXY_IDENTITY_HEADERS.displayName)) || username).slice(0, 191),
    role: (decodeHeader(requestHeaders.get(PROXY_IDENTITY_HEADERS.role)) || "user").slice(0, 64),
  };
}

export function shadowEmail(identity: Pick<ProxyIdentity, "externalUserId" | "username">) {
  const normalized = identity.username.trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) && normalized.length <= 320) return normalized;
  const digest = createHash("sha256").update(identity.externalUserId).digest("hex").slice(0, 32);
  return `lingdraw-${digest}@internal.invalid`;
}
