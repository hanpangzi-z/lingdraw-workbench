import { addAdaptiveProductSlide } from "@/src/lib/ppt/layouts/adaptiveProduct";
import type { LayoutContext } from "@/src/lib/ppt/types";
import { productGrid3Config } from "./config";
export const exportProductGrid3 = (context: LayoutContext) => addAdaptiveProductSlide(context, productGrid3Config);
