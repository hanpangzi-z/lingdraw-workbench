import { productCategories } from "@/data/catalog";
import type { Product, ProductCategory } from "@/types/catalog";
import { UNCATEGORIZED_ID } from "@/src/lib/excel/transform";

export const uncategorizedCategory: ProductCategory = {
  id: UNCATEGORIZED_ID,
  name: "其他 / 未分类",
  englishName: "OTHER",
  description: "待人工补充分类的导入商品。",
  coverImage: productCategories[6].coverImage,
};

export function getProjectCategories(products: Product[]) {
  return products.some((product) => product.categoryId === UNCATEGORIZED_ID)
    ? [...productCategories, uncategorizedCategory]
    : productCategories;
}
