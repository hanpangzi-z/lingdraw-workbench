import type { BatchDimension, BatchDimensionAnalysis, BatchDimensionField, BatchGroup, BatchGroupDimensions } from "@/types/batch";
import type { Product } from "@/types/catalog";
import { BATCH_DIMENSION_LABELS } from "./constants";

const VALUE_SPLITTER = /[；;|,，]+/;

export function splitDimensionValues(value?: string): string[] {
  const values = (value ?? "")
    .split(VALUE_SPLITTER)
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(values.length ? values : ["未设置"] )];
}

function enabledFields(dimensions: BatchDimension[]) {
  return dimensions.filter((dimension) => dimension.enabled).map((dimension) => dimension.field);
}

function productCombinations(product: Product, fields: BatchDimensionField[]): BatchGroupDimensions[] {
  return fields.reduce<BatchGroupDimensions[]>((groups, field) => {
    const values = splitDimensionValues(product[field]);
    return groups.flatMap((group) => values.map((value) => ({ ...group, [field]: value })));
  }, [{}]);
}

function dimensionsKey(dimensions: BatchGroupDimensions, fields: BatchDimensionField[]) {
  return fields.map((field) => `${field}=${dimensions[field] ?? "未设置"}`).join("&");
}

function stableId(key: string) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `batch-${(hash >>> 0).toString(36)}`;
}

export function formatBatchGroupName(dimensions: BatchGroupDimensions, fields?: BatchDimensionField[]) {
  const order = fields ?? (["region", "priceTier", "packageType", "customerGroup"] satisfies BatchDimensionField[]);
  const values = order.map((field) => dimensions[field]).filter((value): value is string => Boolean(value));
  return values.join(" · ") || "全部商品";
}

export function analyzeBatchDimensions(products: Product[]): BatchDimensionAnalysis {
  const fields: BatchDimensionField[] = ["region", "priceTier", "packageType", "customerGroup"];
  const values = Object.fromEntries(fields.map((field) => [field, [...new Set(products.flatMap((product) => splitDimensionValues(product[field]).filter((value) => value !== "未设置")))]])) as Record<BatchDimensionField, string[]>;
  const detectedDimensions = fields.filter((field) => values[field].length > 1);
  const theoreticalCombinations = detectedDimensions.length
    ? detectedDimensions.reduce((total, field) => total * values[field].length, 1)
    : products.length ? 1 : 0;
  return { values, theoreticalCombinations, detectedDimensions };
}

export function getTheoreticalCombinationCount(analysis: BatchDimensionAnalysis, dimensions: BatchDimension[]) {
  const counts = enabledFields(dimensions).map((field) => analysis.values[field].length).filter((count) => count > 0);
  return counts.length ? counts.reduce((total, count) => total * count, 1) : 0;
}

export function createBatchGroups(products: Product[], dimensions: BatchDimension[]): BatchGroup[] {
  const fields = enabledFields(dimensions);
  const buckets = new Map<string, { dimensions: BatchGroupDimensions; productIds: string[] }>();

  for (const product of products) {
    for (const combination of productCombinations(product, fields)) {
      const key = dimensionsKey(combination, fields);
      const bucket = buckets.get(key) ?? { dimensions: combination, productIds: [] };
      if (!bucket.productIds.includes(product.id)) bucket.productIds.push(product.id);
      buckets.set(key, bucket);
    }
  }

  return [...buckets.entries()].map(([key, bucket]) => ({
    id: stableId(key),
    name: formatBatchGroupName(bucket.dimensions, fields),
    dimensions: bucket.dimensions,
    productIds: bucket.productIds,
    productCount: bucket.productIds.length,
    enabled: true,
    status: "ready",
  }));
}

export function describeDetectedDimensions(analysis: BatchDimensionAnalysis) {
  return analysis.detectedDimensions.map((field) => `${BATCH_DIMENSION_LABELS[field]} ${analysis.values[field].length} 个`);
}
