import type { CloudProjectSnapshot } from "./types";
import { withBasePath } from "@/src/lib/basePath";
import { assetIdFromReference } from "@/src/lib/assets/reference";

function transform(value: unknown, compact: boolean): unknown {
  if (typeof value === "string") {
    if (compact) {
      const assetId = assetIdFromReference(value);
      return assetId && !value.startsWith("asset://") ? `asset://${assetId}` : value;
    }
    const assetId = value.startsWith("asset://") ? assetIdFromReference(value) : undefined;
    return assetId ? withBasePath(`/api/assets/${assetId}/content`) : value;
  }
  if (Array.isArray(value)) return value.map((item) => transform(item, compact));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, transform(child, compact)]));
  }
  return value;
}

export function compactAssetReferences<T>(value: T): T {
  return transform(value, true) as T;
}

export function hydrateAssetReferences<T>(value: T): T {
  return transform(value, false) as T;
}

export function compactVersionSnapshot(snapshot: CloudProjectSnapshot) {
  return compactAssetReferences(snapshot);
}

export function hydrateVersionSnapshot(snapshot: CloudProjectSnapshot) {
  return hydrateAssetReferences(snapshot);
}
