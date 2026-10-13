import { productCategories } from "@/data/catalog";
import { parseDeliveryRules } from "@/src/lib/excel/cleaners";
import { UNCATEGORIZED_ID } from "@/src/lib/excel/transform";
import type { Product, ProductCategoryId } from "@/types/catalog";
import type { ProductCandidate } from "./types";

const categoryAliases: Array<[ProductCategoryId, RegExp]> = [
  ["grain-seasoning", /(?:粮油|调味|米面|杂粮)/],
  ["snacks-pastry", /(?:休闲|糕点|零食|坚果|牛奶)/],
  ["braised-food", /(?:卤味|熟食|腊味|酱鸭)/],
  ["fresh-meat", /(?:生鲜|肉禽|海鲜|牛排|猪肉|鸡蛋)/],
  ["kitchen-appliance", /(?:厨具|厨房|电饭煲|锅具|刀具)/],
  ["home-appliance", /(?:家居|家电|加湿|风扇|台灯|音箱)/],
  ["daily-care", /(?:日化|洗护|洗衣|护肤|抽纸|卷纸)/],
];

function resolveCandidateCategory(candidate: ProductCandidate) {
  const explicit = candidate.category?.trim();
  if (explicit) {
    const category = productCategories.find((item) => [item.id, item.name, item.englishName].some((value) => value.toLowerCase() === explicit.toLowerCase()));
    if (category) return category.id;
  }
  const haystack = `${candidate.name ?? ""} ${candidate.items?.join(" ") ?? ""}`;
  return categoryAliases.find(([, pattern]) => pattern.test(haystack))?.[0] ?? UNCATEGORIZED_ID;
}

export function candidatesToProducts(candidates: ProductCandidate[]): Product[] {
  return candidates.map((candidate, index) => {
    const sku = candidate.sku?.trim() ?? "";
    const images = [...new Set(candidate.images ?? [])];
    return {
      id: `document-import-${index + 1}-${sku || candidate.id}`.replace(/[^a-zA-Z0-9一-鿿-_]/g, "-"),
      productNumber: String(index + 1).padStart(2, "0"),
      sku,
      packageCode: sku || `AUTO-${String(index + 1).padStart(3, "0")}`,
      name: candidate.name?.trim() ?? "",
      details: candidate.items ?? [],
      image: images[0],
      images,
      price: { currency: "CNY", market: candidate.marketPrice, package: candidate.salePrice },
      deliveryRegions: parseDeliveryRules(candidate.delivery),
      categoryId: resolveCandidateCategory(candidate),
      rawData: { sourceText: candidate.rawText },
      deliveryRaw: candidate.delivery,
      sources: candidate.sources,
      importMetadata: {
        confidence: candidate.confidence,
        fieldConfidence: candidate.fieldConfidence,
        candidateId: candidate.id,
      },
    } satisfies Product;
  });
}
