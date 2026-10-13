export const INITIAL_THUMBNAIL_RENDER_COUNT = 8;

export function shouldRenderThumbnailImmediately(index: number, selectedIndex: number) {
  return index < INITIAL_THUMBNAIL_RENDER_COUNT || Math.abs(index - selectedIndex) <= 2;
}
