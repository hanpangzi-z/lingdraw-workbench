import { headers } from "next/headers";
import { getPrisma } from "@/src/server/db/prisma";
import { UnauthorizedError } from "@/src/server/errors";
import { identityFromHeaders, shadowEmail, type ProxyIdentity } from "./proxyIdentity";

export interface LingDrawUser {
  id: string;
  externalUserId: string;
  username: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  role: string;
}

async function provisionProxyUser(identity: ProxyIdentity): Promise<LingDrawUser> {
  const prisma = getPrisma();
  const email = shadowEmail(identity);
  const selected = {
    id: true,
    externalUserId: true,
    username: true,
    email: true,
    name: true,
    avatarUrl: true,
    role: true,
  } as const;
  const existing = await prisma.user.findUnique({ where: { externalUserId: identity.externalUserId }, select: selected });
  if (existing) {
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: { username: identity.username, name: identity.displayName, role: identity.role },
      select: selected,
    });
    return { ...updated, externalUserId: updated.externalUserId!, username: updated.username! };
  }

  const legacy = await prisma.user.findUnique({ where: { email }, select: selected });
  if (legacy && !legacy.externalUserId) {
    const updated = await prisma.user.update({
      where: { id: legacy.id },
      data: { externalUserId: identity.externalUserId, username: identity.username, name: identity.displayName, role: identity.role },
      select: selected,
    });
    return { ...updated, externalUserId: updated.externalUserId!, username: updated.username! };
  }

  const safeEmail = legacy ? shadowEmail({ ...identity, externalUserId: `external:${identity.externalUserId}` }) : email;
  try {
    const created = await prisma.user.create({
      data: {
        externalUserId: identity.externalUserId,
        username: identity.username,
        email: safeEmail,
        name: identity.displayName,
        role: identity.role,
      },
      select: selected,
    });
    return { ...created, externalUserId: created.externalUserId!, username: created.username! };
  } catch (error) {
    // Two parallel iframe/API requests may provision the same identity together.
    const raced = await prisma.user.findUnique({ where: { externalUserId: identity.externalUserId }, select: selected });
    if (!raced) throw error;
    const updated = await prisma.user.update({
      where: { id: raced.id },
      data: { username: identity.username, name: identity.displayName, role: identity.role },
      select: selected,
    });
    return { ...updated, externalUserId: updated.externalUserId!, username: updated.username! };
  }
}

export async function currentUser() {
  const identity = identityFromHeaders(await headers());
  return identity ? provisionProxyUser(identity) : undefined;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new UnauthorizedError("灵绘登录已失效，请重新登录");
  return user;
}
