import type { ProductLayoutType } from "../types";
import type { ProductLayoutConfig } from "./configTypes";
import { mixedProductConfig } from "./mixedProduct/config";
import { packageDetailConfig } from "./packageDetail/config";
import { productFeatureConfig } from "./productFeature/config";
import { productGrid2Config } from "./productGrid2/config";
import { productGrid3Config } from "./productGrid3/config";
import { productImageFocusConfig } from "./productImageFocus/config";

export const PRODUCT_LAYOUT_CONFIGS: Record<ProductLayoutType, ProductLayoutConfig> = {
  "product-grid-3": productGrid3Config,
  "product-grid-2": productGrid2Config,
  "product-feature": productFeatureConfig,
  "package-detail": packageDetailConfig,
  "product-image-focus": productImageFocusConfig,
  "mixed-product": mixedProductConfig,
};

export function getProductLayoutConfig(type: ProductLayoutType) {
  return PRODUCT_LAYOUT_CONFIGS[type];
}
