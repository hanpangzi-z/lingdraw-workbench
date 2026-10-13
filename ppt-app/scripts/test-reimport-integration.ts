import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { catalogMeta } from "../data/catalog";
import { mockProducts } from "../data/mock-products";
import { emptyEditorState } from "../types/editor";
import { getPrisma } from "../src/server/db/prisma";
import { createProject, getProject, saveProject, permanentlyDeleteProject } from "../src/server/projects/service";
import { createVersion, listVersions, restoreVersion } from "../src/server/versions/service";
import type { CloudProjectSnapshot } from "../src/server/projects/types";

// Only this script's uniquely named user/project are touched or cleaned up.
async function main() {
  const db = getPrisma();
  const token = randomUUID();
  const owner = await db.user.create({ data: { externalUserId: `reimport-test-${token}`, email: `reimport-${token}@lingdraw.test`, name: "Reimport integration fixture" } });
  let projectId: string | undefined;
  try {
    const original: CloudProjectSnapshot = {
      project: { ...catalogMeta, projectName: `Reimport fixture ${token}`, design: { ...catalogMeta.design, brandColor: "#123456" } },
      products: mockProducts.slice(0, 2).map((p) => ({ ...p, image: undefined, images: [] })),
      layoutMode: "smart", layoutOverrides: {},
      editorState: { ...emptyEditorState(), slides: { s1: { slideId: "s1", customTitle: "原稿人工编辑" } }, lockedSlideIds: ["s1"] },
    };
    const initialRequests = await Promise.all([createProject(owner.id, { snapshot: original, creationKey: token }), createProject(owner.id, { snapshot: original, creationKey: token })]);
    const created = initialRequests[0];
    assert.equal(created.id, initialRequests[1].id);
    projectId = created.id;
    const repeated = await Promise.all([createProject(owner.id, { snapshot: original, creationKey: token }), createProject(owner.id, { snapshot: original, creationKey: token })]);
    assert.ok(repeated.every((item) => item.id === projectId));
    assert.equal(await db.project.count({ where: { userId: owner.id } }), 1);
    const baseline = await getProject(owner.id, projectId);
    const replacement: CloudProjectSnapshot = { ...baseline.snapshot, products: baseline.snapshot.products.slice(0, 1), editorState: emptyEditorState() };

    // Real DB transaction + injected failures prove rollback, not just call order.
    for (const failure of ["backup", "replacement"] as const) {
      const originalTransaction = db.$transaction;
      db.$transaction = ((fn: (tx: unknown) => Promise<unknown>, ...args: unknown[]) => originalTransaction.call(db, async (tx) => {
        const failingTx = new Proxy(tx, {
          get(target, prop) {
            const key = failure === "backup" ? "projectVersion" : "projectProductSnapshot";
            if (prop !== key) return Reflect.get(target, prop);
            return new Proxy(Reflect.get(target, prop), {
              get(delegate, method) {
                if (method === (failure === "backup" ? "create" : "createMany")) return async () => { throw new Error(`injected-${failure}`); };
                return Reflect.get(delegate, method);
              },
            });
          },
        });
        return fn(failingTx);
      }, ...args as [])) as typeof db.$transaction;
      try {
        await assert.rejects(saveProject(owner.id, projectId, baseline.revision, replacement, { reimportRequestId: randomUUID() }), new RegExp(`injected-${failure}`));
      } finally { db.$transaction = originalTransaction; }
      const unchanged = await getProject(owner.id, projectId);
      assert.equal(unchanged.revision, baseline.revision);
      assert.deepEqual(unchanged.snapshot, baseline.snapshot);
      assert.equal((await listVersions(owner.id, projectId)).length, 0);
    }

    await assert.rejects(saveProject(owner.id, projectId, baseline.revision, { ...replacement, products: [] }, { reimportRequestId: randomUUID() }), /有效商品/);
    const requestId = randomUUID();
    const saved = await saveProject(owner.id, projectId, baseline.revision, replacement, { reimportRequestId: requestId });
    const after = await getProject(owner.id, projectId);
    assert.equal(after.productCount, 1);
    assert.deepEqual(after.snapshot.editorState, emptyEditorState());
    const versions = await listVersions(owner.id, projectId);
    assert.equal(versions.length, 1);
    assert.equal(versions[0].label, "重新导入前自动备份");
    const retried = await saveProject(owner.id, projectId, baseline.revision, replacement, { reimportRequestId: requestId });
    assert.equal(retried.revision, saved.revision);
    assert.equal((await listVersions(owner.id, projectId)).length, 1);
    await assert.rejects(saveProject(owner.id, projectId, baseline.revision, original, { reimportRequestId: randomUUID() }), /更新/);
    await restoreVersion(owner.id, projectId, versions[0].id);
    const restored = await getProject(owner.id, projectId);
    assert.deepEqual(restored.snapshot, baseline.snapshot);
    const beforeVersion = (await listVersions(owner.id, projectId)).length;
    await assert.rejects(createVersion(owner.id, projectId, { expectedRevision: baseline.revision, snapshot: baseline.snapshot }), /修订号/);
    assert.equal((await listVersions(owner.id, projectId)).length, beforeVersion);
    await createVersion(owner.id, projectId, { expectedRevision: restored.revision, snapshot: restored.snapshot });
    assert.equal((await listVersions(owner.id, projectId)).length, beforeVersion + 1);
    console.log("PASS: idempotent project creation; stale version blocked; saved revision version accepted");
    console.log("PASS: backup failure rollback; replacement failure rollback; empty import blocked; atomic replacement; idempotent retry; revision conflict; complete backup restore");
  } finally {
    if (projectId) await permanentlyDeleteProject(owner.id, projectId);
    await db.user.delete({ where: { id: owner.id } });
    await db.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
