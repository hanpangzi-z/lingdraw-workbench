import type { BatchDimension, BatchDimensionField, GlobalBatchConfig } from "@/types/batch";

export const BATCH_DIMENSION_LABELS: Record<BatchDimensionField, string> = {
  region: "地区",
  priceTier: "价格档位",
  packageType: "套餐类型",
  customerGroup: "客户",
};

export const DEFAULT_BATCH_DIMENSIONS: BatchDimension[] = [
  { field: "region", enabled: true },
  { field: "priceTier", enabled: true },
  { field: "packageType", enabled: false },
  { field: "customerGroup", enabled: false },
];

export const DEFAULT_BATCH_CONFIG: GlobalBatchConfig = {
  dimensions: DEFAULT_BATCH_DIMENSIONS,
  filenameRule: "{year}{region}{projectName}-{priceTier}产品手册",
  titleRule: "{region}{projectName}",
  subtitleRule: "{priceTier}档位产品手册",
  version: "v1",
  exportFormat: "pptx",
  templateId: "business-standard",
  themeId: "business-red",
};
