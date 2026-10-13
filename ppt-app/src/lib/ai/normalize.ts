import { productCategories } from "@/data/catalog";
import type { Product } from "@/types/catalog";
import type { AIIssue, AIProductMetadata, AIProductProposal, AISuggestion, AISuggestionField, AIValue } from "@/types/ai";

const fieldLabels: Record<AISuggestionField, string> = {
  name: "商品名称",
  details: "商品明细",
  deliveryRegions: "配送说明",
  categoryId: "商品分类",
  sku: "SKU",
  marketPrice: "市场价",
  salePrice: "套餐价",
};

function originalFor(product: Product, field: AISuggestionField): AIValue {
  if (field === "marketPrice") return product.price.market ?? null;
  if (field === "salePrice") return product.price.package ?? null;
  if (field === "deliveryRegions" && product.deliveryRaw) return [product.deliveryRaw];
  const value = product[field];
  return Array.isArray(value) ? [...value] : value ?? null;
}

function proposedFor(proposal: AIProductProposal, field: AISuggestionField): AIValue {
  if (field === "name") return proposal.normalizedName;
  if (field === "details") return proposal.normalizedItems;
  if (field === "deliveryRegions") return proposal.normalizedDelivery ? [proposal.normalizedDelivery] : [];
  if (field === "categoryId") return proposal.categoryId;
  return null;
}

function sameValue(a: AIValue, b: AIValue) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function proposalsToMetadata(
  product: Product,
  proposal: AIProductProposal,
  provider: "openai" | "mock",
  localIssues: AIIssue[] = [],
): AIProductMetadata {
  const suggestions: AISuggestion[] = proposal.changes.flatMap((change, index) => {
    const originalValue = originalFor(product, change.field);
    const suggestedValue = proposedFor(proposal, change.field);
    if (suggestedValue === null || sameValue(originalValue, suggestedValue)) return [];
    if (change.field === "categoryId" && !productCategories.some((category) => category.id === suggestedValue)) return [];
    return [{
      id: `${product.id}-${change.field}-${index}`,
      field: change.field,
      label: fieldLabels[change.field],
      originalValue,
      suggestedValue,
      confidence: Math.max(0, Math.min(1, change.confidence)),
      reason: change.reason,
      accepted: false,
      status: "pending" as const,
      canApply: true,
      source: provider,
    }];
  });

  const warningSuggestions: AISuggestion[] = proposal.warnings.map((warning, index) => ({
    id: `${product.id}-warning-${warning.code}-${index}`,
    field: warning.field,
    label: fieldLabels[warning.field],
    originalValue: originalFor(product, warning.field),
    suggestedValue: originalFor(product, warning.field),
    confidence: Math.max(0, Math.min(1, warning.confidence)),
    reason: warning.message,
    accepted: false,
    status: "pending",
    canApply: false,
    source: provider,
  }));

  const issues = [...localIssues, ...proposal.warnings.map((warning) => ({
    code: warning.code,
    productId: product.id,
    field: warning.field,
    severity: "warning" as const,
    message: warning.message,
  }))];
  const allSuggestions = [...suggestions, ...warningSuggestions];
  return {
    status: allSuggestions.some((item) => item.status === "pending") || issues.length ? "needs-review" : "processed",
    suggestions: allSuggestions,
    issues,
    provider,
    lastProcessedAt: new Date().toISOString(),
  };
}

export function applyProductSuggestion(product: Product, suggestionId: string, accept: boolean): Product {
  const metadata = product.aiMetadata;
  if (!metadata) return product;
  const suggestion = metadata.suggestions.find((item) => item.id === suggestionId);
  if (!suggestion || suggestion.status !== "pending") return product;

  const nextSuggestions = metadata.suggestions.map((item) => item.id === suggestionId
    ? { ...item, accepted: accept && item.canApply, status: accept && item.canApply ? "accepted" as const : "rejected" as const }
    : item);
  let nextProduct: Product = { ...product };
  if (accept && suggestion.canApply) {
    if (suggestion.field === "name" && typeof suggestion.suggestedValue === "string") nextProduct.name = suggestion.suggestedValue;
    if (suggestion.field === "details" && Array.isArray(suggestion.suggestedValue)) nextProduct.details = suggestion.suggestedValue.map(String);
    if (suggestion.field === "deliveryRegions" && Array.isArray(suggestion.suggestedValue)) {
      nextProduct.deliveryRegions = suggestion.suggestedValue.map(String);
      nextProduct.deliveryNormalized = suggestion.suggestedValue.join("；");
    }
    if (suggestion.field === "categoryId" && typeof suggestion.suggestedValue === "string"
      && productCategories.some((category) => category.id === suggestion.suggestedValue)) {
      nextProduct.categoryId = suggestion.suggestedValue as Product["categoryId"];
    }
  }
  const pending = nextSuggestions.filter((item) => item.status === "pending").length;
  nextProduct.aiMetadata = {
    ...metadata,
    suggestions: nextSuggestions,
    status: pending ? "needs-review" : "processed",
  };
  return nextProduct;
}
