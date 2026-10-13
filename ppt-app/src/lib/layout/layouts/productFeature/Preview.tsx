import { SharedProductLayoutPreview } from "../SharedPreview";
import { productFeatureConfig } from "./config";
export function ProductFeaturePreview(props: Omit<Parameters<typeof SharedProductLayoutPreview>[0], "config">) { return <SharedProductLayoutPreview {...props} config={productFeatureConfig} />; }
