import { SharedProductLayoutPreview } from "../SharedPreview";
import { productImageFocusConfig } from "./config";
export function ProductImageFocusPreview(props: Omit<Parameters<typeof SharedProductLayoutPreview>[0], "config">) { return <SharedProductLayoutPreview {...props} config={productImageFocusConfig} />; }
