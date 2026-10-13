import { randomUUID } from "node:crypto";
import { catalogMeta } from "../data/catalog";
import { mockProducts } from "../data/mock-products";
import { emptyEditorState } from "../types/editor";
import { getPrisma } from "../src/server/db/prisma";
import { ConflictError, ForbiddenError } from "../src/server/errors";
import { createAsset, listProjectAssets } from "../src/server/assets/service";
import { createProject, duplicateProject, getProject, listProjects, permanentlyDeleteProject, restoreProject, saveProject, softDeleteProject } from "../src/server/projects/service";
import { createVersion, listVersions, restoreVersion } from "../src/server/versions/service";
import { applyTemplateToDesign, resetTemplateDesign } from "../src/templates/registry";
import { resolveTheme } from "../src/themes/registry";
import type { CloudProjectSnapshot } from "../src/server/projects/types";

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

async function main() {
  const token = randomUUID().slice(0, 8);
  const owner = await getPrisma().user.create({ data: { externalUserId: `test-owner-${token}`, username: `cloud-owner-${token}`, email: `cloud-owner-${token}@lingdraw.test`, name: "Cloud Test" } });
  const stranger = await getPrisma().user.create({ data: { externalUserId: `test-stranger-${token}`, username: `cloud-stranger-${token}`, email: `cloud-stranger-${token}@lingdraw.test` } });
  let projectId = "";
  let copyId = "";
  try {
    const products = mockProducts.slice(0, 4).map((product) => ({ ...product, image: undefined, images: undefined }));
    const created = await createProject(owner.id, { name: `Cloud integration ${token}`, snapshot: { project: { ...catalogMeta, projectName: `Cloud integration ${token}` }, products, layoutMode: "smart", layoutOverrides: {}, editorState: emptyEditorState() } });
    projectId = created.id;
    assert(created.productCount === 4, "project products were not persisted");
    assert((await getPrisma().project.findUnique({ where: { id: projectId }, select: { thumbnailAssetId: true, thumbnailDirty: true } }))?.thumbnailAssetId, "project thumbnail was not generated");

    const saved = await saveProject(owner.id, projectId, created.revision, { ...created.snapshot, layoutMode: "force-grid-3" });
    assert(saved.revision === created.revision + 1, "revision did not increment");
    let conflict = false;
    try { await saveProject(owner.id, projectId, created.revision, created.snapshot); } catch (error) { conflict = error instanceof ConflictError; }
    assert(conflict, "stale save did not return a revision conflict");

    // Exercise the JSON/save/reload boundary used when returning from another
    // host module. A cleared optional color is omitted from the HTTP payload.
    let themed = await getProject(owner.id, projectId);
    const saveDesign = async (design: CloudProjectSnapshot["project"]["design"]) => {
      const snapshot = JSON.parse(JSON.stringify({ ...themed.snapshot, project: { ...themed.snapshot.project, design } })) as CloudProjectSnapshot;
      await saveProject(owner.id, projectId, themed.revision, snapshot);
      themed = await getProject(owner.id, projectId);
      const restored = themed.snapshot.project.design;
      return resolveTheme(restored.themeId, restored.themeOverrides, restored.brandColor).colors.primary;
    };
    assert(await saveDesign({ ...themed.snapshot.project.design, brandColor: "#8B3F14" }) === "#8B3F14", "custom brand color did not survive save/reload");
    assert(await saveDesign(applyTemplateToDesign(themed.snapshot.project.design, "corporate-blue")) === "#184E77", "old brand color returned after applying Business Blue and reloading");
    assert(themed.snapshot.project.design.brandColor === undefined, "applying a template did not clear the stored brand color");
    assert(await saveDesign({ ...themed.snapshot.project.design, brandColor: "#FF6600" }) === "#FF6600", "explicit custom color was lost on reload");
    assert(await saveDesign(resetTemplateDesign(themed.snapshot.project.design, "corporate-blue")) === "#184E77", "resetting the template did not persist its default blue");
    const reloaded = await getProject(owner.id, projectId);
    assert(reloaded.snapshot.project.design.brandColor === undefined, "cleared brand color returned on a second reload");
    assert(reloaded.snapshot.products.map((product) => product.id).join() === products.map((product) => product.id).join(), "theme changes altered the product data");

    const file = new File(["sku,name\n1,test"], `integration-${token}.csv`, { type: "text/csv" });
    await createAsset({ userId: owner.id, projectId, file, type: "source_file" });
    assert((await listProjectAssets(projectId, owner.id)).some((asset) => asset.type === "source_file"), "source asset was not stored");

    const current = await getProject(owner.id, projectId);
    const version = await createVersion(owner.id, projectId, { label: "integration checkpoint", snapshot: current.snapshot });
    assert((await listVersions(owner.id, projectId)).length === 1, "version was not created");
    await restoreVersion(owner.id, projectId, version.id);
    assert((await listVersions(owner.id, projectId)).length === 2, "restore did not preserve the current state first");

    let forbidden = false;
    try { await getProject(stranger.id, projectId); } catch (error) { forbidden = error instanceof ForbiddenError; }
    assert(forbidden, "cross-user project access was not rejected");

    const copy = await duplicateProject(owner.id, projectId);
    copyId = copy.id;
    assert(copy.productCount === 4, "project copy lost products");
    await softDeleteProject(owner.id, copyId);
    await restoreProject(owner.id, copyId);
    assert(!(await getProject(owner.id, copyId)).deletedAt, "soft-deleted project was not restored");

    await getPrisma().project.createMany({ data: Array.from({ length: 100 }, (_, index) => ({ userId: owner.id, name: `Pagination ${token} ${String(index + 1).padStart(3, "0")}` })) });
    const listed = await listProjects(owner.id, { page: 1, pageSize: 20, search: `Pagination ${token}` });
    assert(listed.items.length === 20 && listed.total === 100 && listed.pageCount === 5, "100-project pagination is incorrect");
    await getPrisma().project.deleteMany({ where: { userId: owner.id, name: { startsWith: `Pagination ${token}` } } });
    console.log("云端集成测试通过: proxy-user / revision / theme save-reload / asset / thumbnail / version / authorization / copy / trash / 100-project pagination");
  } finally {
    if (copyId) await permanentlyDeleteProject(owner.id, copyId).catch(() => undefined);
    if (projectId) await permanentlyDeleteProject(owner.id, projectId).catch(() => undefined);
    await getPrisma().user.deleteMany({ where: { id: { in: [owner.id, stranger.id] } } });
    await getPrisma().$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
