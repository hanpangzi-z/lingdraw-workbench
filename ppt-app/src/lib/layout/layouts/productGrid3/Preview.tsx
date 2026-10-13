import { SharedProductLayoutPreview } from "../SharedPreview";
import { productGrid3Config } from "./config";
export function ProductGrid3Preview(props: Omit<Parameters<typeof SharedProductLayoutPreview>[0], "config">) { return <SharedProductLayoutPreview {...props} config={productGrid3Config} />; }
