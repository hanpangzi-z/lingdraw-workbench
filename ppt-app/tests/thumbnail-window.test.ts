import { describe, expect, it } from "vitest";
import {
  INITIAL_THUMBNAIL_RENDER_COUNT,
  shouldRenderThumbnailImmediately,
} from "@/src/lib/editor/thumbnailWindow";

describe("thumbnail render window", () => {
  it("renders only the first visible rail and the active neighborhood eagerly", () => {
    for (let index = 0; index < INITIAL_THUMBNAIL_RENDER_COUNT; index += 1) {
      expect(shouldRenderThumbnailImmediately(index, 0)).toBe(true);
    }
    expect(shouldRenderThumbnailImmediately(40, 0)).toBe(false);
    expect(shouldRenderThumbnailImmediately(39, 40)).toBe(true);
    expect(shouldRenderThumbnailImmediately(40, 40)).toBe(true);
    expect(shouldRenderThumbnailImmediately(42, 40)).toBe(true);
    expect(shouldRenderThumbnailImmediately(43, 40)).toBe(false);
  });
});
