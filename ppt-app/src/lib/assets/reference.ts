const ASSET_ID = "[A-Za-z0-9_-]+";
const ASSET_PROTOCOL = new RegExp(`^asset://(${ASSET_ID})$`);
const ASSET_CONTENT_ROUTE = new RegExp(`/api/assets/(${ASSET_ID})/content(?:[?#][^\\s]*)?$`);

/** Parses only complete asset references; path suffixes are never truncated into a valid ID. */
export function assetIdFromReference(value?: string | null) {
  if (!value) return undefined;
  return (value.match(ASSET_PROTOCOL) || value.match(ASSET_CONTENT_ROUTE))?.[1];
}

export function isAssetReferenceLike(value: string) {
  return value.startsWith("asset://") || value.includes("/api/assets/");
}
