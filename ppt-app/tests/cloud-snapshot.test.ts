import { describe, expect, it } from "vitest";
import { compactAssetReferences, hydrateAssetReferences } from "@/src/server/projects/snapshot";

describe("project snapshot asset references", () => {
  it("stores asset ids instead of session URLs and restores private routes", () => {
    const input = {
      logo: "/ppt/api/assets/logo-1/content",
      products: [{ images: ["/ppt/api/assets/image-1/content", "https://cdn.example.com/remote.jpg"] }],
      editor: { source: "/ppt/api/assets/image-2/content?preview=1" },
    };
    const compact = compactAssetReferences(input);
    expect(compact).toEqual({
      logo: "asset://logo-1",
      products: [{ images: ["asset://image-1", "https://cdn.example.com/remote.jpg"] }],
      editor: { source: "asset://image-2" },
    });
    expect(hydrateAssetReferences(compact)).toEqual({ ...input, editor: { source: "/ppt/api/assets/image-2/content" } });
  });

  it("keeps non-asset values untouched", () => {
    const input = { count: 33, enabled: true, items: ["云耳 120g", null] };
    expect(compactAssetReferences(input)).toEqual(input);
  });
});
