import type { Product } from "@/types/catalog";
import type { ProductCandidate } from "./types";
import { pptFetch } from "@/src/lib/basePath";

interface LibraryImageRecommendation {
  sku: string;
  globalProductId: string;
  globalProductVersion: number;
  imageAssetId: string;
  imageUrl: string;
}

async function fetchRecommendations(skus: string[]) {
  const unique = [...new Set(skus.map((sku) => sku.trim()).filter(Boolean))];
  if (!unique.length) return new Map<string, LibraryImageRecommendation>();
  try {
    const response = await pptFetch("/api/products/image-recommendations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skus: unique }),
    });
    if (!response.ok) throw new Error(`商品库图片查询失败 (${response.status})`);
    const payload = await response.json() as { items: LibraryImageRecommendation[] };
    return new Map(payload.items.map((item) => [item.sku.trim().toLowerCase(), item]));
  } catch (error) {
    console.warn("[Import Pipeline] 商品库图片推荐不可用，继续使用本次上传图片", error);
    return new Map<string, LibraryImageRecommendation>();
  }
}

export async function preferLibraryImagesForCandidates(candidates: ProductCandidate[]) {
  const recommendations = await fetchRecommendations(candidates.map((candidate) => candidate.sku || ""));
  let matched = 0;
  const next = candidates.map((candidate) => {
    const recommendation = recommendations.get(candidate.sku?.trim().toLowerCase() || "");
    if (!recommendation) return candidate;
    matched += 1;
    return {
      ...candidate,
      images: [recommendation.imageUrl, ...(candidate.images || []).filter((image) => image !== recommendation.imageUrl)],
      fieldConfidence: { ...candidate.fieldConfidence, image: 1 },
    };
  });
  return { candidates: next, matched };
}

export async function preferLibraryImagesForProducts(products: Product[]) {
  const recommendations = await fetchRecommendations(products.map((product) => product.sku));
  let matched = 0;
  const next = products.map((product) => {
    const recommendation = recommendations.get(product.sku.trim().toLowerCase());
    if (!recommendation) return product;
    matched += 1;
    const images = [recommendation.imageUrl, ...(product.images || []).filter((image) => image !== recommendation.imageUrl)];
    return { ...product, image: images[0], images, globalProductId: recommendation.globalProductId, globalProductVersion: recommendation.globalProductVersion };
  });
  return { products: next, matched };
}
