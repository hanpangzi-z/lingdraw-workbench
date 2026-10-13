import type { Product } from "@/types/catalog";
import type { ProductValidation } from "@/types/import";

export function validateProduct(product: Product): ProductValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!product.name.trim()) errors.push("套餐名称为空");
  if (product.components?.length && !product.components.some((component) => component.name.trim())) warnings.push("商品名称为空");
  if (!product.details.length) warnings.push("商品明细为空");
  if (product.price.market === undefined) warnings.push("市场价为空");
  if (product.price.package === undefined) warnings.push("组合价为空");
  if (!(product.images?.length || product.image)) warnings.push("商品图片为空");

  return {
    status: errors.length ? "error" : warnings.length ? "warning" : "valid",
    messages: [...errors, ...warnings],
  };
}
