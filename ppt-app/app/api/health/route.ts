import { getPrisma } from "@/src/server/db/prisma";
import { getStorageProvider } from "@/src/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function databaseStatus() {
  try {
    const rows = await getPrisma().$queryRaw<{ version: string }[]>`SELECT VERSION() AS version`;
    if (!rows[0]?.version.startsWith('8.0.')) throw new Error('MySQL 8.0 required');
    return { ok: true, status: "connected" };
  } catch {
    return { ok: false, status: "unavailable", message: "database unavailable" };
  }
}

async function storageStatus() {
  const provider = process.env.STORAGE_PROVIDER === "s3" ? "s3" : "local";
  try {
    await getStorageProvider().health();
    return { ok: true, status: "available", provider };
  } catch {
    return { ok: false, status: "unavailable", provider };
  }
}

export async function GET() {
  const [database, storage] = await Promise.all([databaseStatus(), storageStatus()]);
  const service = { ok: true, status: "running" };
  const ok = database.ok && storage.ok;
  return Response.json({ ok, service, database, storage, checks: { service, database, storage } }, {
    status: ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
