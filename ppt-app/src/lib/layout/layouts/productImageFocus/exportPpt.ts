import { addAdaptiveProductSlide } from "@/src/lib/ppt/layouts/adaptiveProduct";
import type { LayoutContext } from "@/src/lib/ppt/types";
import { productImageFocusConfig } from "./config";
export const exportProductImageFocus = (context: LayoutContext) => addAdaptiveProductSlide(context, productImageFocusConfig);
