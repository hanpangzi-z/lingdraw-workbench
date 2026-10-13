import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  database: vi.fn(),
  storage: vi.fn(),
}));

vi.mock("@/src/server/db/prisma", () => ({
  getPrisma: () => ({ $queryRaw: mocks.database }),
}));

vi.mock("@/src/lib/storage", () => ({
  getStorageProvider: () => ({ health: mocks.storage }),
}));

import { GET } from "@/app/api/health/route";

describe("PPT internal health route", () => {
  beforeEach(() => {
    mocks.database.mockReset().mockResolvedValue([{ version: '8.0.45' }]);
    mocks.storage.mockReset().mockResolvedValue(undefined);
    delete process.env.STORAGE_PROVIDER;
  });

  it("performs real provider and database probes", async () => {
    const response = await GET();
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.database).toHaveBeenCalledOnce();
    expect(mocks.storage).toHaveBeenCalledOnce();
    expect(payload).toMatchObject({
      ok: true,
      database: { ok: true, status: "connected" },
      storage: { ok: true, status: "available", provider: "local" },
    });
  });

  it("reports an S3 connectivity failure without leaking the provider error", async () => {
    process.env.STORAGE_PROVIDER = "s3";
    mocks.storage.mockRejectedValue(new Error("secret endpoint and bucket detail"));
    const response = await GET();
    const payload = await response.json();
    expect(response.status).toBe(503);
    expect(payload.storage).toEqual({ ok: false, status: "unavailable", provider: "s3" });
    expect(JSON.stringify(payload)).not.toContain("secret endpoint");
  });

  it("reports database failure without exposing a connection string", async () => {
    mocks.database.mockRejectedValue(new Error("postgres://user:password@db/private"));
    const response = await GET();
    const payload = await response.json();
    expect(response.status).toBe(503);
    expect(payload.database).toEqual({ ok: false, status: "unavailable", message: "database unavailable" });
    expect(JSON.stringify(payload)).not.toContain("password");
  });
  it('rejects a MySQL 8.4 server', async () => {
    mocks.database.mockResolvedValue([{ version: '8.4.8' }]);
    expect((await GET()).status).toBe(503);
  });
});
