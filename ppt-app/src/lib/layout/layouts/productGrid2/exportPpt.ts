import { addAdaptiveProductSlide } from "@/src/lib/ppt/layouts/adaptiveProduct";
import type { LayoutContext } from "@/src/lib/ppt/types";
import { productGrid2Config } from "./config";
export const exportProductGrid2 = (context: LayoutContext) => addAdaptiveProductSlide(context, productGrid2Config);
