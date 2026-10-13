import { SharedProductLayoutPreview } from "../SharedPreview";
import { productGrid2Config } from "./config";
export function ProductGrid2Preview(props: Omit<Parameters<typeof SharedProductLayoutPreview>[0], "config">) { return <SharedProductLayoutPreview {...props} config={productGrid2Config} />; }
