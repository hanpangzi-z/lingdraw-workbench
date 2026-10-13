import type { AIFieldDetectionResponse, AINormalizationResponse } from "@/types/ai";

export interface StructuredSchema<T> {
  name: string;
  schema: Record<string, unknown>;
  validate: (value: unknown) => value is T;
}

const editableFields = ["name", "details", "deliveryRegions", "categoryId"] as const;
const suggestionFields = [...editableFields, "sku", "marketPrice", "salePrice"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const fieldDetectionSchema: StructuredSchema<AIFieldDetectionResponse> = {
  name: "catalog_field_detection",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      mappings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            targetField: { type: "string" },
            sourceColumn: { type: ["string", "null"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reason: { type: "string" },
          },
          required: ["targetField", "sourceColumn", "confidence", "reason"],
        },
      },
    },
    required: ["mappings"],
  },
  validate(value): value is AIFieldDetectionResponse {
    if (!isRecord(value) || !Array.isArray(value.mappings)) return false;
    return value.mappings.every((item) => isRecord(item)
      && typeof item.targetField === "string"
      && (typeof item.sourceColumn === "string" || item.sourceColumn === null)
      && typeof item.confidence === "number"
      && item.confidence >= 0
      && item.confidence <= 1
      && typeof item.reason === "string");
  },
};

export const normalizationSchema: StructuredSchema<AINormalizationResponse> = {
  name: "catalog_product_normalization",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      products: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            productId: { type: "string" },
            normalizedName: { type: ["string", "null"] },
            normalizedItems: { type: "array", items: { type: "string" } },
            normalizedDelivery: { type: ["string", "null"] },
            categoryId: { type: ["string", "null"] },
            changes: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  field: { type: "string", enum: editableFields },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                  reason: { type: "string" },
                },
                required: ["field", "confidence", "reason"],
              },
            },
            warnings: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  code: { type: "string" },
                  field: { type: "string", enum: suggestionFields },
                  message: { type: "string" },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                },
                required: ["code", "field", "message", "confidence"],
              },
            },
          },
          required: ["productId", "normalizedName", "normalizedItems", "normalizedDelivery", "categoryId", "changes", "warnings"],
        },
      },
    },
    required: ["products"],
  },
  validate(value): value is AINormalizationResponse {
    if (!isRecord(value) || !Array.isArray(value.products)) return false;
    return value.products.every((product) => {
      if (!isRecord(product)
        || typeof product.productId !== "string"
        || !(typeof product.normalizedName === "string" || product.normalizedName === null)
        || !Array.isArray(product.normalizedItems)
        || !product.normalizedItems.every((item) => typeof item === "string")
        || !(typeof product.normalizedDelivery === "string" || product.normalizedDelivery === null)
        || !(typeof product.categoryId === "string" || product.categoryId === null)
        || !Array.isArray(product.changes)
        || !Array.isArray(product.warnings)) return false;
      const changesValid = product.changes.every((change) => isRecord(change)
        && editableFields.includes(change.field as typeof editableFields[number])
        && typeof change.confidence === "number"
        && typeof change.reason === "string");
      const warningsValid = product.warnings.every((warning) => isRecord(warning)
        && typeof warning.code === "string"
        && suggestionFields.includes(warning.field as typeof suggestionFields[number])
        && typeof warning.message === "string"
        && typeof warning.confidence === "number");
      return changesValid && warningsValid;
    });
  },
};
