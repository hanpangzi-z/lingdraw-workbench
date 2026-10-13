import { randomUUID } from "node:crypto";
import { getPrisma } from "../src/server/db/prisma";
import { createAsset, deleteAsset, getAssetReferenceSummary, listUserAssets } from "../src/server/assets/service";
import { ResourceConflictError } from "../src/server/errors";
import { addLibraryProductsToProject, applyProjectProductSync, createGlobalProduct, getProjectProductSync, listGlobalProducts, recommendLibraryProductImages, updateGlobalProduct } from "../src/server/library/products";
import { applyTemplateToProject, copyTemplate, listTemplates } from "../src/server/library/templates";
import { getProject, permanentlyDeleteProject } from "../src/server/projects/service";
import { getStorageProvider } from "../src/lib/storage";

const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

async function main() {
  const token = randomUUID().slice(0, 8);
  const user = await getPrisma().user.create({ data: { externalUserId: `test-library-${token}`, username: `library-${token}`, email: `library-${token}@lingdraw.test`, name: "Library Test" } });
  let projectId = "";
  try {
    const category = await getPrisma().productCategory.create({ data: { ownerId: user.id, name: "测试分类", code: `test-${token}` } });
    const product = await createGlobalProduct(user.id, { sku: `SKU-${token}`, name: "商品库快照测试", items: ["规格 A", "规格 B"], marketPrice: 168, defaultSalePrice: 100, categoryId: category.id });

    const bytes = new File(["same-image-content"], `same-${token}.png`, { type: "image/png" });
    const firstAsset = await createAsset({ userId: user.id, file: bytes, type: "product_image" });
    const secondAsset = await createAsset({ userId: user.id, file: new File(["same-image-content"], `duplicate-${token}.png`, { type: "image/png" }), type: "product_image" });
    assert(firstAsset.id === secondAsset.id && "deduplicated" in secondAsset, "asset content hash deduplication failed");
    await getPrisma().productAsset.create({ data: { productId: product.id, assetId: firstAsset.id, role: "primary" } });
    await getPrisma().globalProduct.update({ where: { id: product.id }, data: { primaryImageAssetId: firstAsset.id } });
    const recommendations = await recommendLibraryProductImages(user.id, [product.sku]);
    assert(recommendations.items[0]?.imageAssetId === firstAsset.id, "SKU did not prefer the GlobalProduct primary image");
    assert((await getAssetReferenceSummary(firstAsset.id, user.id)).total >= 2, "asset references were not counted");
    let protectedDelete = false; try { await deleteAsset(user.id, firstAsset.id); } catch (error) { protectedDelete = error instanceof ResourceConflictError; }
    assert(protectedDelete, "referenced asset deletion was not protected");

    const createdProject = await addLibraryProductsToProject(user.id, { productIds: [product.id], projectName: `资源库项目 ${token}` });
    projectId = createdProject.projectId;
    const project = await getProject(user.id, projectId);
    assert(project.snapshot.products[0].globalProductId === product.id && project.snapshot.products[0].price.market === 168, "project product snapshot was not detached correctly");
    await updateGlobalProduct(user.id, product.id, { name: "商品库新版名称", marketPrice: 188 }, "测试版本升级");
    const sync = await getProjectProductSync(user.id, projectId);
    assert(sync.length === 1 && sync[0].fields.includes("name") && sync[0].fields.includes("marketPrice"), "library update diff was not detected");
    await applyProjectProductSync(user.id, projectId, { updates: [{ clientId: sync[0].clientId, fields: ["name"] }] });
    const syncedProject = await getProject(user.id, projectId);
    assert(syncedProject.snapshot.products[0].name === "商品库新版名称" && syncedProject.snapshot.products[0].price.market === 168, "field-level snapshot sync is incorrect");

    const templates = await listTemplates(user.id, { pageSize: 20 });
    assert(templates.items.filter((item) => item.isSystem).length >= 3, "system templates are not visible");
    const copied = await copyTemplate(user.id, templates.items[0].id);
    assert(!copied.isSystem && copied.scope === "personal", "system template copy did not create a personal template");
    await applyTemplateToProject(user.id, copied.id, projectId);
    assert((await getProject(user.id, projectId)).snapshot.project.design.templateDefinitionId === copied.id, "template snapshot was not applied to project");

    await getPrisma().globalProduct.createMany({ data: Array.from({ length: 5000 }, (_, index) => ({ ownerId: user.id, sku: `PERF-${token}-${index}`, name: `规模商品 ${String(index).padStart(5, "0")}`, items: [], searchText: `PERF ${token} 规模商品 ${index}` })) });
    const started = performance.now();
    const page = await listGlobalProducts(user.id, { page: 1, pageSize: 30, search: "规模商品 04999" });
    const elapsed = Math.round(performance.now() - started);
    assert(page.total === 1 && page.items[0].sku.endsWith("4999"), "5,000-product indexed search returned incorrect data");
    assert(elapsed < 3000, `5,000-product search too slow: ${elapsed}ms`);
    await getPrisma().templateDefinition.createMany({ data: Array.from({ length: 100 }, (_, index) => ({
      ownerId: user.id, name: `PERF-TEMPLATE-${token}-${String(index).padStart(3, "0")}`, description: "规模模板", category: "商品目录",
      status: "published", rendererKey: "business-standard", config: {}, tags: [], searchText: `PERF-TEMPLATE-${token}-${String(index).padStart(3, "0")}`, scope: "personal",
    })) });
    const templateStarted = performance.now();
    const templatePage = await listTemplates(user.id, { page: 1, pageSize: 24, search: `PERF-TEMPLATE-${token}-099` });
    const templateElapsed = Math.round(performance.now() - templateStarted);
    assert(templatePage.total === 1, "100-template indexed search returned incorrect data");
    assert(templateElapsed < 3000, `100-template search too slow: ${templateElapsed}ms`);

    await getPrisma().asset.createMany({ data: Array.from({ length: 10000 }, (_, index) => ({
      userId: user.id, type: "product_image", fileName: `PERF-ASSET-${token}-${String(index).padStart(5, "0")}.png`,
      storageKey: `perf/${token}/${index}`, mimeType: "image/png", size: BigInt(1), checksum: `perf-${token}-${index}`,
    })) });
    const assetStarted = performance.now();
    const assetPage = await listUserAssets(user.id, { page: 1, pageSize: 30, search: `PERF-ASSET-${token}-09999` });
    const assetElapsed = Math.round(performance.now() - assetStarted);
    assert(assetPage.total === 1, "10,000-asset paginated search returned incorrect data");
    assert(assetElapsed < 3000, `10,000-asset search too slow: ${assetElapsed}ms`);
    console.log(`资源库集成测试通过: snapshot / diff / selective sync / image dedupe / reference protection / template copy+apply / 5,000 products (${elapsed}ms) / 100 templates (${templateElapsed}ms) / 10,000 assets (${assetElapsed}ms)`);
  } finally {
    if (projectId) await permanentlyDeleteProject(user.id, projectId).catch(() => undefined);
    await getPrisma().asset.deleteMany({ where: { userId: user.id, storageKey: { startsWith: `perf/${token}/` } } }).catch(() => undefined);
    const assets = await getPrisma().asset.findMany({ where: { userId: user.id }, select: { storageKey: true } });
    for (const asset of assets) await getStorageProvider().delete(asset.storageKey).catch(() => undefined);
    await getPrisma().user.delete({ where: { id: user.id } }).catch(() => undefined);
    await getPrisma().$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
