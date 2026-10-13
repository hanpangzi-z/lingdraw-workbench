export type AIEditableField = "name" | "details" | "deliveryRegions" | "categoryId";
export type AICriticalField = "sku" | "marketPrice" | "salePrice";
export type AISuggestionField = AIEditableField | AICriticalField;
export type AIValue = string | number | string[] | null;

export interface AISuggestion {
  id: string;
  field: AISuggestionField;
  label: string;
  originalValue: AIValue;
  suggestedValue: AIValue;
  confidence: number;
  reason: string;
  accepted: boolean;
  status: "pending" | "accepted" | "rejected";
  canApply: boolean;
  source: "openai" | "mock";
}

export interface AIIssue {
  code: string;
  productId: string;
  field?: AISuggestionField;
  severity: "warning" | "error";
  message: string;
}

export interface AIProductMetadata {
  status: "unprocessed" | "processing" | "processed" | "needs-review" | "failed";
  suggestions: AISuggestion[];
  issues: AIIssue[];
  provider?: "openai" | "mock";
  lastProcessedAt?: string;
  error?: string;
}

export interface AIUsageSummary {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimated: boolean;
}

export interface AIScanSummary {
  totalProducts: number;
  problemProductIds: string[];
  issues: AIIssue[];
  byCode: Record<string, number>;
}

export interface AIProcessingState {
  status: "idle" | "scanning" | "processing" | "completed" | "partial" | "failed";
  total: number;
  processed: number;
  failed: number;
  currentBatch: number;
  batchCount: number;
  failedProductIds: string[];
  message?: string;
}

export interface AIFieldMappingProposal {
  targetField: string;
  sourceColumn: string | null;
  confidence: number;
  reason: string;
}

export interface AIFieldDetectionResponse {
  mappings: AIFieldMappingProposal[];
}

export interface AINormalizationChange {
  field: AIEditableField;
  confidence: number;
  reason: string;
}

export interface AINormalizationWarning {
  code: string;
  field: AISuggestionField;
  message: string;
  confidence: number;
}

export interface AIProductProposal {
  productId: string;
  normalizedName: string | null;
  normalizedItems: string[];
  normalizedDelivery: string | null;
  categoryId: string | null;
  changes: AINormalizationChange[];
  warnings: AINormalizationWarning[];
}

export interface AINormalizationResponse {
  products: AIProductProposal[];
}

export interface AICategoryCandidate {
  id: string;
  name: string;
}

export interface AIProviderUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimated?: boolean;
}
