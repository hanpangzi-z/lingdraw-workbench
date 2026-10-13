import { SharedProductLayoutPreview } from "../SharedPreview";
import { packageDetailConfig } from "./config";
export function PackageDetailPreview(props: Omit<Parameters<typeof SharedProductLayoutPreview>[0], "config">) { return <SharedProductLayoutPreview {...props} config={packageDetailConfig} />; }
