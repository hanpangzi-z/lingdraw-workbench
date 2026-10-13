import type { BatchCheckIssue, BatchCheckReport, BatchGroup } from "@/types/batch";
import type { Product } from "@/types/catalog";
import type { SlidePlan } from "@/src/lib/layout/types";
import { getProductImages } from "@/src/lib/catalog/images";

export function validateBatchGroup(group: BatchGroup, products: Product[], plans: SlidePlan[]): BatchCheckReport {
  const issues: BatchCheckIssue[] = [];
  if (!products.length) issues.push({ code: "empty-project", severity: "error", message: "项目没有商品" });

  const missingNames = products.filter((product) => !product.name.trim());
  if (missingNames.length) issues.push({ code: "missing-name", severity: "error", message: `${missingNames.length} 个商品缺少名称`, productIds: missingNames.map((product) => product.id) });
  const missingImages = products.filter((product) => !getProductImages(product).length);
  if (missingImages.length) issues.push({ code: "missing-image", severity: "warning", message: `缺少 ${missingImages.length} 张商品图片`, productIds: missingImages.map((product) => product.id) });
  const missingPrices = products.filter((product) => product.price.package === undefined);
  if (missingPrices.length) issues.push({ code: "missing-price", severity: "warning", message: `${missingPrices.length} 个商品缺少套餐价`, productIds: missingPrices.map((product) => product.id) });

  const skuGroups = new Map<string, string[]>();
  products.forEach((product) => {
    const sku = product.sku.trim().toLocaleLowerCase();
    if (!sku) return;
    skuGroups.set(sku, [...(skuGroups.get(sku) ?? []), product.id]);
  });
  const duplicateIds = [...skuGroups.values()].filter((ids) => ids.length > 1).flat();
  if (duplicateIds.length) issues.push({ code: "duplicate-sku", severity: "warning", message: `存在 ${duplicateIds.length} 个重复 SKU 记录`, productIds: duplicateIds });

  const overflowPlans = plans.filter((plan) => plan.overflow.overflow);
  if (overflowPlans.length) issues.push({ code: "text-overflow", severity: "warning", message: `${overflowPlans.length} 页触发文字溢出保护`, productIds: overflowPlans.flatMap((plan) => plan.productIds) });
  const invalidPlans = plans.filter((plan) => !plan.productIds.length);
  if (invalidPlans.length) issues.push({ code: "layout-error", severity: "error", message: `${invalidPlans.length} 页没有可渲染商品` });

  const status = issues.some((issue) => issue.severity === "error") ? "error" : issues.length ? "warning" : "ready";
  return { status, issues, checkedAt: Date.now() };
}

export function summarizeBatchReports(groups: BatchGroup[]) {
  return {
    total: groups.length,
    ready: groups.filter((group) => group.status === "ready" || group.status === "completed").length,
    warning: groups.filter((group) => group.status === "warning").length,
    error: groups.filter((group) => group.status === "error").length,
  };
}
