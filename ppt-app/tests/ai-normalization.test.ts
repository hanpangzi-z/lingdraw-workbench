import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as normalizeRoute } from "@/app/api/ai/normalize-products/route";
import { scanProductsForAI } from "@/src/lib/ai/analyze";
import { processInBatches } from "@/src/lib/ai/batch";
import { applyProductSuggestion, proposalsToMetadata } from "@/src/lib/ai/normalize";
import { MockAIProvider } from "@/src/lib/ai/providers/mock";
import { buildFieldDetectionUserPrompt, buildNormalizationUserPrompt, FIELD_DETECTION_SYSTEM_PROMPT, NORMALIZATION_SYSTEM_PROMPT } from "@/src/lib/ai/prompts";
import { fieldDetectionSchema, normalizationSchema } from "@/src/lib/ai/schemas";
import type { Product } from "@/types/catalog";

const categories = [
  { id: "grain-seasoning", name: "粮油调味" },
  { id: "snacks-pastry", name: "休闲糕点" },
  { id: "braised-food", name: "卤味熟食" },
  { id: "fresh-meat", name: "生鲜肉禽" },
  { id: "kitchen-appliance", name: "厨具家电" },
  { id: "home-appliance", name: "家居家电" },
  { id: "daily-care", name: "日化洗护" },
];

function product(patch: Partial<Product> = {}): Product {
  return {
    id: "product-1",
    productNumber: "01",
    sku: "LP-01",
    packageCode: "LP-01",
    name: "【2026员工福利专享】臻选菌菇礼盒（100元档位）",
    details: ["云耳120g；珍珠菇80g；鹿茸菇70g"],
    price: { currency: "CNY", market: 168, package: 100 },
    deliveryRegions: ["全国（不含新疆、西藏）"],
    deliveryRaw: "全国（不含新疆、西藏）",
    categoryId: "uncategorized",
    ...patch,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AI_MOCK_MODE;
});

describe("AI structured normalization", () => {
  it("uses AI only to fill semantically non-standard headers", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generateStructuredData(
      FIELD_DETECTION_SYSTEM_PROMPT,
      buildFieldDetectionUserPrompt({
        headers: ["产品代码", "礼盒标题", "内含商品", "门店价", "员工价", "送达说明"],
        unmatchedTargets: [
          { key: "sku", label: "SKU", description: "编码" },
          { key: "name", label: "商品名称", description: "标题" },
          { key: "items", label: "商品明细", description: "内容" },
          { key: "delivery", label: "配送区域", description: "范围" },
        ],
        sampleRows: [],
      }),
      fieldDetectionSchema,
    );
    expect(result.mappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetField: "sku", sourceColumn: "产品代码" }),
      expect.objectContaining({ targetField: "name", sourceColumn: "礼盒标题" }),
      expect.objectContaining({ targetField: "items", sourceColumn: "内含商品" }),
      expect.objectContaining({ targetField: "delivery", sourceColumn: "送达说明" }),
    ]));
  });

  it("returns conservative field-level changes and keeps critical values read-only", async () => {
    const source = product({ price: { currency: "CNY", market: 88, package: 100 } });
    const provider = new MockAIProvider();
    const response = await provider.generateStructuredData(
      NORMALIZATION_SYSTEM_PROMPT,
      buildNormalizationUserPrompt({ products: [source], categoryCandidates: categories }),
      normalizationSchema,
    );
    const proposal = response.products[0];
    expect(proposal.changes.map((item) => item.field)).toEqual(expect.arrayContaining(["name", "details", "deliveryRegions", "categoryId"]));
    expect(proposal.changes.some((item) => ["sku", "marketPrice", "salePrice"].includes(item.field))).toBe(false);
    expect(proposal.warnings).toContainEqual(expect.objectContaining({ code: "price-inversion", field: "marketPrice" }));

    const metadata = proposalsToMetadata(source, proposal, "mock");
    const priceWarning = metadata.suggestions.find((item) => item.field === "marketPrice");
    expect(priceWarning?.canApply).toBe(false);
    const unchanged = applyProductSuggestion({ ...source, aiMetadata: metadata }, priceWarning!.id, true);
    expect(unchanged.price).toEqual(source.price);
    expect(unchanged.sku).toBe(source.sku);
  });

  it("preserves raw values until a user explicitly accepts a suggestion", async () => {
    const source = product();
    const provider = new MockAIProvider();
    const response = await provider.generateStructuredData(
      NORMALIZATION_SYSTEM_PROMPT,
      buildNormalizationUserPrompt({ products: [source], categoryCandidates: categories }),
      normalizationSchema,
    );
    const metadata = proposalsToMetadata(source, response.products[0], "mock");
    const nameSuggestion = metadata.suggestions.find((item) => item.field === "name")!;
    const staged = { ...source, aiMetadata: metadata };
    expect(staged.name).toBe(source.name);
    expect(nameSuggestion.originalValue).toBe(source.name);
    const accepted = applyProductSuggestion(staged, nameSuggestion.id, true);
    expect(accepted.name).not.toBe(source.name);
    expect(accepted.rawData).toBe(source.rawData);
  });

  it("normalizes mixed unit casing and multiplication symbols without losing quantities", async () => {
    const source = product({ name: "家庭清洁洗护套装", details: ["洗衣液2KG*1；抽纸100抽*6"] });
    const provider = new MockAIProvider();
    const response = await provider.generateStructuredData(
      NORMALIZATION_SYSTEM_PROMPT,
      buildNormalizationUserPrompt({ products: [source], categoryCandidates: categories }),
      normalizationSchema,
    );
    expect(response.products[0].normalizedItems).toEqual(["洗衣液2kg×1", "抽纸100抽×6"]);
  });

  it("detects duplicate SKU, packed items, nonstandard delivery and price inversion locally", () => {
    const products = [
      product({ id: "a", sku: "DUP", price: { currency: "CNY", market: 80, package: 100 } }),
      product({ id: "b", sku: "DUP", name: "正常名称" }),
    ];
    const scan = scanProductsForAI(products);
    expect(scan.byCode["duplicate-sku"]).toBe(2);
    expect(scan.byCode["packed-items"]).toBe(2);
    expect(scan.byCode["nonstandard-delivery"]).toBe(2);
    expect(scan.byCode["price-inversion"]).toBe(1);
  });

  it("serves the same strict schema through the mock API route without an API key", async () => {
    process.env.AI_MOCK_MODE = "true";
    const source = product();
    const request = new Request("http://localhost/api/ai/normalize-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ products: [source], categoryCandidates: categories }),
    });
    const response = await normalizeRoute(request);
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.provider).toBe("mock");
    expect(normalizationSchema.validate(payload.data)).toBe(true);
    expect(payload.usage.totalTokens).toBeGreaterThan(0);
  });
});

describe("AI batch resilience", () => {
  it("retries at most twice and preserves successful batches when one batch fails", async () => {
    const items = Array.from({ length: 25 }, (_, index) => ({ id: `p-${index + 1}` }));
    const attempts = new Map<string, number>();
    const result = await processInBatches({
      items,
      batchSize: 12,
      maxRetries: 2,
      processBatch: async (batch) => {
        const key = batch[0].id;
        attempts.set(key, (attempts.get(key) ?? 0) + 1);
        if (key === "p-13") throw new Error("simulated failure");
        return batch.map((item) => item.id);
      },
    });
    expect(result.outputs).toHaveLength(13);
    expect(result.failedIds).toHaveLength(12);
    expect(attempts.get("p-13")).toBe(3);
    expect(result.outputs).toContain("p-1");
    expect(result.outputs).toContain("p-25");
  });

  it("recovers a transient batch failure on retry", async () => {
    let attempts = 0;
    const result = await processInBatches({
      items: [{ id: "one" }],
      processBatch: async (batch) => {
        attempts += 1;
        if (attempts < 2) throw new Error("temporary");
        return batch.map((item) => item.id);
      },
    });
    expect(attempts).toBe(2);
    expect(result).toEqual({ outputs: ["one"], failedIds: [] });
  });

  it("reuses one idempotency key for retries but not for different batches", async () => {
    const contexts: Array<{ batch: string; requestId: string; attempt: number }> = [];
    const attempts = new Map<string, number>();
    await processInBatches({
      items: [{ id: "one" }, { id: "two" }],
      batchSize: 1,
      processBatch: async (batch, context) => {
        contexts.push({ batch: batch[0].id, ...context });
        attempts.set(batch[0].id, (attempts.get(batch[0].id) ?? 0) + 1);
        if (batch[0].id === "one" && attempts.get("one") === 1) throw new Error("connection lost");
        return batch.map((item) => item.id);
      },
    });
    expect(contexts[0].requestId).toBe(contexts[1].requestId);
    expect(contexts[0].attempt).toBe(0);
    expect(contexts[1].attempt).toBe(1);
    expect(contexts[2].requestId).not.toBe(contexts[0].requestId);
  });
});

describe("AI runtime schemas", () => {
  it("rejects malformed normalization output", () => {
    expect(normalizationSchema.validate({ products: [{ productId: "x", changes: [] }] })).toBe(false);
    expect(fieldDetectionSchema.validate({ mappings: [{ targetField: "name", sourceColumn: "标题", confidence: 4, reason: "x" }] })).toBe(false);
  });
});
