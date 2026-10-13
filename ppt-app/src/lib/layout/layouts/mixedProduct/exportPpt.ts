import { addAdaptiveProductSlide } from "@/src/lib/ppt/layouts/adaptiveProduct";
import type { LayoutContext } from "@/src/lib/ppt/types";
import { mixedProductConfig } from "./config";
export const exportMixedProduct = (context: LayoutContext) => addAdaptiveProductSlide(context, mixedProductConfig);
