import type { BatchGroupDimensions } from "@/types/batch";
import type { CatalogMeta } from "@/types/catalog";

type Variables = Record<"year" | "region" | "priceTier" | "projectName" | "packageType" | "customerGroup" | "version", string>;

export function getBatchVariables(meta: CatalogMeta, dimensions: BatchGroupDimensions, version = ""): Variables {
  const region = dimensions.region ?? meta.city ?? "";
  const projectName = region && meta.projectName.startsWith(region) ? meta.projectName.slice(region.length) : meta.projectName;
  return {
    year: String(meta.year),
    region,
    priceTier: dimensions.priceTier ?? meta.tierName ?? (meta.priceTier ? `${meta.priceTier}元` : ""),
    projectName,
    packageType: dimensions.packageType ?? "",
    customerGroup: dimensions.customerGroup ?? "",
    version,
  };
}

export function applyBatchRule(rule: string, variables: Variables) {
  return rule.replace(/\{(year|region|priceTier|projectName|packageType|customerGroup|version)\}/g, (_, key: keyof Variables) => variables[key] ?? "")
    .replace(/[·\-—_]{2,}/g, "-")
    .replace(/^\s*[·\-—_]+|[·\-—_]+\s*$/g, "")
    .trim();
}

export function sanitizeBatchFileName(value: string) {
  return value.replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-").replace(/\s+/g, "").slice(0, 180) || "产品手册";
}

export function buildBatchFileName(rule: string, variables: Variables, version?: string) {
  const base = sanitizeBatchFileName(applyBatchRule(rule, variables));
  const normalizedVersion = (version ?? "").trim();
  const suffix = normalizedVersion && !rule.includes("{version}") ? `-${sanitizeBatchFileName(normalizedVersion)}` : "";
  return `${base}${suffix}.pptx`;
}
