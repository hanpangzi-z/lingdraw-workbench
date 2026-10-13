import { productCategories } from "@/data/catalog";
import type { Product } from "@/types/catalog";
import type { AIIssue, AIScanSummary, AISuggestionField } from "@/types/ai";

const canonicalDeliveries = ["全国配送 A 类", "全国配送 B 类", "沪浙苏皖闽", "江浙沪皖", "江浙沪", "按招标文件执行"];

function issue(product: Product, code: string, message: string, field?: AISuggestionField, severity: "warning" | "error" = "warning"): AIIssue {
  return { productId: product.id, code, message, field, severity };
}

export function scanProductsForAI(products: Product[]): AIScanSummary {
  const issues: AIIssue[] = [];
  const skuCounts = new Map<string, number>();
  products.forEach((product) => {
    const sku = product.sku.trim().toLocaleLowerCase("zh-CN");
    if (sku) skuCounts.set(sku, (skuCounts.get(sku) ?? 0) + 1);
  });

  for (const product of products) {
    const sku = product.sku.trim().toLocaleLowerCase("zh-CN");
    if (!sku) issues.push(issue(product, "missing-sku", "SKU 为空，仅提示、不自动补造", "sku"));
    else if ((skuCounts.get(sku) ?? 0) > 1) issues.push(issue(product, "duplicate-sku", "SKU 与其他商品重复，仅提示、不自动修改", "sku"));
    if (!product.name.trim()) issues.push(issue(product, "missing-name", "商品名称为空，需要人工补充", "name", "error"));
    else if (product.name.length > 24 || /福利专供|员工专享|档位|方案|特惠|甄选.{0,4}推荐/.test(product.name)) {
      issues.push(issue(product, "messy-name", "商品名称可能包含营销后缀或过长", "name"));
    }
    if (!product.details.length) issues.push(issue(product, "missing-items", "商品明细为空", "details"));
    else if (product.details.length === 1 && /[；;|、/]/.test(product.details[0])) issues.push(issue(product, "packed-items", "商品明细可能挤在同一行", "details"));
    else if (product.details.some((item) => item.length > 54)) issues.push(issue(product, "long-item", "商品明细存在过长条目", "details"));
    if (!product.deliveryRegions.length) issues.push(issue(product, "missing-delivery", "配送说明为空", "deliveryRegions"));
    else if (!product.deliveryRegions.every((value) => canonicalDeliveries.includes(value))) {
      issues.push(issue(product, "nonstandard-delivery", "配送说明尚未归一为标准规则", "deliveryRegions"));
    }
    if (!productCategories.some((category) => category.id === product.categoryId)) {
      issues.push(issue(product, "missing-category", "商品分类为空或未识别", "categoryId"));
    }
    if (product.price.market !== undefined && product.price.package !== undefined && product.price.market < product.price.package) {
      issues.push(issue(product, "price-inversion", "市场价低于套餐价，仅提示、不自动修改", "marketPrice"));
    }
    if (product.price.market === undefined) issues.push(issue(product, "missing-market-price", "市场价为空，仅提示、不自动补造", "marketPrice"));
    if (product.price.package === undefined) issues.push(issue(product, "missing-sale-price", "套餐价为空，仅提示、不自动修改", "salePrice"));
  }

  const byCode = issues.reduce<Record<string, number>>((acc, item) => {
    acc[item.code] = (acc[item.code] ?? 0) + 1;
    return acc;
  }, {});
  return {
    totalProducts: products.length,
    problemProductIds: [...new Set(issues.map((item) => item.productId))],
    issues,
    byCode,
  };
}
