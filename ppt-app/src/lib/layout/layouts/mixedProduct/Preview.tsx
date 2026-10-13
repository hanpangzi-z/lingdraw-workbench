import { SharedProductLayoutPreview } from "../SharedPreview";
import { mixedProductConfig } from "./config";
export function MixedProductPreview(props: Omit<Parameters<typeof SharedProductLayoutPreview>[0], "config">) { return <SharedProductLayoutPreview {...props} config={mixedProductConfig} />; }
