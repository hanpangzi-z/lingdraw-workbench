import { addAdaptiveProductSlide } from "@/src/lib/ppt/layouts/adaptiveProduct";
import type { LayoutContext } from "@/src/lib/ppt/types";
import { packageDetailConfig } from "./config";
export const exportPackageDetail = (context: LayoutContext) => addAdaptiveProductSlide(context, packageDetailConfig);
