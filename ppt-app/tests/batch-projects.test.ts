import JSZip from "jszip";
import path from "node:path";
import * as XLSX from "xlsx";
import { beforeEach, describe, expect, it } from "vitest";
import { catalogMeta } from "@/data/catalog";
import { DEFAULT_BATCH_CONFIG, DEFAULT_BATCH_DIMENSIONS } from "@/src/lib/batch/constants";
import { runBatchExportQueue } from "@/src/lib/batch/exportQueue";
import { analyzeBatchDimensions, createBatchGroups } from "@/src/lib/batch/grouping";
import { resolveBatchProject, resolveBatchProducts } from "@/src/lib/batch/resolve";
import { createBatchDataHash } from "@/src/lib/batch/slidePlanCache";
import { useBatchStore } from "@/src/store/batchStore";
import { autoMapFields } from "@/src/lib/excel/mapping";
import { BATCH_IMPORT_FIELD_DEFINITIONS } from "@/src/lib/excel/fields";
import { detectHeaderRow, getSheetHeaders } from "@/src/lib/excel/parser";
import { convertSheetToProducts } from "@/src/lib/excel/transform";
import type { BatchGroup, ProductProjectOverride, ResolvedBatchProject } from "@/types/batch";
import type { Product } from "@/types/catalog";

const onePixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlQn0YAAAAASUVORK5CYII=";
const realCombinations = [
  ["上海", "100元"],
  ["上海", "200元"],
  ["上海", "300元"],
  ["江苏", "100元"],
  ["江苏", "200元"],
  ["浙江", "100元"],
] as const;

function product(id: string, region: string, priceTier: string, patch: Partial<Product> = {}): Product {
  return {
    id,
    productNumber: id.replace(/\D/g, "").padStart(2, "0") || "01",
    sku: `SKU-${id}`,
    packageCode: `SKU-${id}`,
    name: `测试商品 ${id}`,
    images: [onePixelPng],
    image: onePixelPng,
    details: ["商品 A 100g", "商品 B 200g"],
    price: { currency: "CNY", market: 168, package: 100 },
    deliveryRegions: ["全国配送 A 类"],
    categoryId: "grain-seasoning",
    region,
    priceTier,
    packageType: "职工福利",
    ...patch,
  };
}

function sixCombinationProducts() {
  return realCombinations.map(([region, tier], index) => product(`p${index + 1}`, region, tier));
}

function resolvedJobs(products = sixCombinationProducts()): ResolvedBatchProject[] {
  const groups = createBatchGroups(products, DEFAULT_BATCH_DIMENSIONS);
  return groups.map((group) => resolveBatchProject(catalogMeta, products, { ...DEFAULT_BATCH_CONFIG }, group, []));
}

beforeEach(() => {
  useBatchStore.getState().resetBatch();
  useBatchStore.getState().setConfig({ ...DEFAULT_BATCH_CONFIG, dimensions: DEFAULT_BATCH_DIMENSIONS.map((item) => ({ ...item })) });
});

describe("Phase 10 batch projects", () => {
  it("imports the 65-row multi-region Excel example into six real groups", () => {
    const workbook = XLSX.readFile(path.join(process.cwd(), "public/examples/multi-region-products.xlsx"));
    const rows = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(workbook.Sheets["批量商品数据"], { header: 1, raw: false, defval: "", blankrows: true });
    const sheet = { name: "批量商品数据", rows, nonEmptyRowCount: rows.filter((row) => row.some((cell) => String(cell ?? "").trim())).length };
    const headerRow = detectHeaderRow(sheet);
    const config = { fileName: "multi-region-products.xlsx", sheetName: sheet.name, headerRow, fieldMappings: autoMapFields(getSheetHeaders(sheet, headerRow), BATCH_IMPORT_FIELD_DEFINITIONS), splitItemsBySlash: false };
    const products = convertSheetToProducts(sheet, config);
    expect(headerRow).toBe(3);
    expect(products).toHaveLength(65);
    expect(products[0]).toMatchObject({ region: "上海；江苏；浙江", priceTier: "100元", packageType: "职工福利", customerGroup: "工会职工" });
    expect(createBatchGroups(products, DEFAULT_BATCH_DIMENSIONS)).toHaveLength(6);
  });

  it("creates only six real groups for a theoretical 3×3 matrix", () => {
    const products = sixCombinationProducts();
    const analysis = analyzeBatchDimensions(products);
    const groups = createBatchGroups(products, DEFAULT_BATCH_DIMENSIONS);
    expect(analysis.theoreticalCombinations).toBe(9);
    expect(groups).toHaveLength(6);
    expect(groups.some((group) => group.dimensions.region === "浙江" && group.dimensions.priceTier === "200元")).toBe(false);
    const shanghai = resolveBatchProject(catalogMeta, products, DEFAULT_BATCH_CONFIG, groups.find((group) => group.dimensions.region === "上海" && group.dimensions.priceTier === "100元")!, []);
    expect(shanghai.project.title).toBe("上海职工乐品福利方案");
    expect(shanghai.fileName).toBe("2026上海职工乐品福利方案-100元产品手册-v1.pptx");
  });

  it("builds an independent slide plan for a five-product group", () => {
    const products = Array.from({ length: 5 }, (_, index) => product(`five-${index}`, "上海", "100元"));
    const group = createBatchGroups(products, DEFAULT_BATCH_DIMENSIONS)[0];
    const resolved = resolveBatchProject(catalogMeta, products, DEFAULT_BATCH_CONFIG, group, []);
    expect(resolved.products).toHaveLength(5);
    expect(resolved.slidePlans.flatMap((plan) => plan.productIds)).toEqual(products.map((item) => item.id));
    expect(resolved.pageCount).toBe(resolved.slidePlans.length + 4);
  });

  it("builds an independent slide plan for a thirty-product group", () => {
    const products = Array.from({ length: 30 }, (_, index) => product(`thirty-${index}`, "江苏", "100元"));
    const group = createBatchGroups(products, DEFAULT_BATCH_DIMENSIONS)[0];
    const resolved = resolveBatchProject(catalogMeta, products, DEFAULT_BATCH_CONFIG, group, []);
    expect(resolved.products).toHaveLength(30);
    expect(resolved.slidePlans.flatMap((plan) => plan.productIds)).toHaveLength(30);
    expect(createBatchDataHash(resolved.project, resolved.products)).toBe(resolved.dataHash);
  });

  it("reuses one shared product and its image array across three projects", () => {
    const shared = product("shared", "上海；江苏；浙江", "100元");
    const groups = createBatchGroups([shared], DEFAULT_BATCH_DIMENSIONS);
    expect(groups).toHaveLength(3);
    groups.forEach((group) => {
      const resolved = resolveBatchProducts([shared], group, []);
      expect(resolved[0].id).toBe(shared.id);
      expect(resolved[0].images).toBe(shared.images);
    });
  });

  it("reports the impact range before a shared product update", () => {
    const shared = product("shared-impact", "上海；江苏；浙江", "100元");
    const store = useBatchStore.getState();
    store.initializeBatch(catalogMeta, [shared]);
    expect(useBatchStore.getState().getProductImpactCount(shared.id)).toBe(3);
    useBatchStore.getState().updateSharedProduct(shared.id, { price: { market: 188 } });
    expect(useBatchStore.getState().baseProducts[0].price.market).toBe(188);
  });

  it("applies a project-level price override only to the selected group", () => {
    const shared = product("shared-price", "上海；江苏", "100元");
    const groups = createBatchGroups([shared], DEFAULT_BATCH_DIMENSIONS);
    const jiangsu = groups.find((group) => group.dimensions.region === "江苏")!;
    const overrides: ProductProjectOverride[] = [{ batchGroupId: jiangsu.id, productId: shared.id, overrides: { price: { package: 99 } } }];
    expect(resolveBatchProducts([shared], jiangsu, overrides)[0].price.package).toBe(99);
    expect(resolveBatchProducts([shared], groups.find((group) => group.dimensions.region === "上海")!, overrides)[0].price.package).toBe(100);
    expect(shared.price.package).toBe(100);
  });

  it("sequentially exports six PPT jobs", async () => {
    const order: string[] = [];
    const output = await runBatchExportQueue(resolvedJobs(), { zipName: "six.zip", generateJob: async (job) => { order.push(job.group.id); return new Uint8Array([80, 75, order.length]); } });
    expect(output.succeeded).toBe(6);
    expect(output.failed).toBe(0);
    expect(order).toEqual(resolvedJobs().map((job) => job.group.id));
  });

  it("continues the queue when one project fails", async () => {
    const jobs = resolvedJobs();
    const completed: string[] = [];
    const output = await runBatchExportQueue(jobs, { zipName: "partial.zip", generateJob: async (job) => {
      if (job.group.id === jobs[2].group.id) throw new Error("图片格式转换失败");
      completed.push(job.group.id);
      return new Uint8Array([80, 75, completed.length]);
    } });
    expect(output.succeeded).toBe(5);
    expect(output.failed).toBe(1);
    expect(output.failedGroupIds).toEqual([jobs[2].group.id]);
    expect(completed).toHaveLength(5);
  });

  it("packages successful PPTX files into one readable ZIP", async () => {
    const jobs = resolvedJobs();
    const output = await runBatchExportQueue(jobs, { zipName: "catalogs.zip", generateJob: async () => new Uint8Array([1, 2, 3]) });
    const bytes = output.zip instanceof Blob ? new Uint8Array(await output.zip.arrayBuffer()) : output.zip;
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).sort()).toEqual(jobs.map((job) => job.fileName).sort());
  });

  it("resolves different themes for different groups", () => {
    const products = sixCombinationProducts();
    const groups = createBatchGroups(products, DEFAULT_BATCH_DIMENSIONS);
    const blue: BatchGroup = { ...groups[3], projectConfig: { themeId: "corporate-blue" } };
    const redProject = resolveBatchProject(catalogMeta, products, DEFAULT_BATCH_CONFIG, groups[0], []);
    const blueProject = resolveBatchProject(catalogMeta, products, DEFAULT_BATCH_CONFIG, blue, []);
    expect(redProject.project.design.themeId).toBe("business-red");
    expect(blueProject.project.design.themeId).toBe("corporate-blue");
  });

  it("applies one logo to every group through global inheritance", () => {
    const products = sixCombinationProducts();
    const store = useBatchStore.getState();
    store.initializeBatch(catalogMeta, products);
    useBatchStore.getState().applyLogoToAll(onePixelPng);
    const current = useBatchStore.getState();
    current.groups.forEach((group) => expect(current.getResolvedGroup(group.id)?.project.logo).toBe(onePixelPng));
  });

  it("deletes a group without deleting any shared product", () => {
    const products = sixCombinationProducts();
    const store = useBatchStore.getState();
    store.initializeBatch(catalogMeta, products);
    const target = useBatchStore.getState().groups[0];
    useBatchStore.getState().deleteGroup(target.id);
    expect(useBatchStore.getState().groups).toHaveLength(5);
    expect(useBatchStore.getState().baseProducts).toHaveLength(products.length);
    expect(useBatchStore.getState().baseProducts.map((item) => item.id)).toEqual(products.map((item) => item.id));
  });
});
