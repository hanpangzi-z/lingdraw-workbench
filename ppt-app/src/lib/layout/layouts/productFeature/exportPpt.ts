import { addAdaptiveProductSlide } from "@/src/lib/ppt/layouts/adaptiveProduct";
import type { LayoutContext } from "@/src/lib/ppt/types";
import { productFeatureConfig } from "./config";
export const exportProductFeature = (context: LayoutContext) => addAdaptiveProductSlide(context, productFeatureConfig);
