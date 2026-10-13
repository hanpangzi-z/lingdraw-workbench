export function clampSlideIndex(index: number, slideCount: number) {
  return Math.min(Math.max(index, 0), Math.max(slideCount - 1, 0));
}
