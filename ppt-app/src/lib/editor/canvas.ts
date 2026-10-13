import { defaultCanvasElementTransform, type CanvasElementOverride, type CanvasElementTransform } from "@/types/editor";

export const CANVAS_MIN_SCALE = 0.2;
export const CANVAS_MAX_SCALE = 4;
export const CANVAS_VIEWPORT_ZOOM_LEVELS = [50, 75, 100, 125] as const;

export type CanvasViewportZoom = "fit" | number;

export function clampCanvasScale(value: number) {
  return Math.min(CANVAS_MAX_SCALE, Math.max(CANVAS_MIN_SCALE, value));
}

export function stepCanvasViewportZoom(
  current: CanvasViewportZoom,
  direction: "in" | "out",
): number {
  const currentValue = current === "fit" ? 100 : current;
  if (direction === "in") {
    return CANVAS_VIEWPORT_ZOOM_LEVELS.find((level) => level > currentValue)
      ?? CANVAS_VIEWPORT_ZOOM_LEVELS[CANVAS_VIEWPORT_ZOOM_LEVELS.length - 1];
  }
  return [...CANVAS_VIEWPORT_ZOOM_LEVELS].reverse().find((level) => level < currentValue)
    ?? CANVAS_VIEWPORT_ZOOM_LEVELS[0];
}

export function resolveCanvasTransform(override?: CanvasElementOverride): CanvasElementTransform {
  return { ...defaultCanvasElementTransform(), ...override?.transform };
}

export function moveCanvasTransform(
  transform: CanvasElementTransform,
  deltaX: number,
  deltaY: number,
): CanvasElementTransform {
  return { ...transform, x: transform.x + deltaX, y: transform.y + deltaY };
}

export function resizeCanvasTransform(
  transform: CanvasElementTransform,
  direction: string,
  deltaX: number,
  deltaY: number,
  elementWidthPercent: number,
  elementHeightPercent: number,
): CanvasElementTransform {
  const horizontalRatio = elementWidthPercent > 0 ? deltaX / elementWidthPercent : 0;
  const verticalRatio = elementHeightPercent > 0 ? deltaY / elementHeightPercent : 0;
  let { x, y, scaleX, scaleY } = transform;

  if (direction.includes("e")) scaleX = clampCanvasScale(scaleX * (1 + horizontalRatio));
  if (direction.includes("s")) scaleY = clampCanvasScale(scaleY * (1 + verticalRatio));
  if (direction.includes("w")) {
    const nextScale = clampCanvasScale(scaleX * (1 - horizontalRatio));
    x += deltaX;
    scaleX = nextScale;
  }
  if (direction.includes("n")) {
    const nextScale = clampCanvasScale(scaleY * (1 - verticalRatio));
    y += deltaY;
    scaleY = nextScale;
  }

  return { ...transform, x, y, scaleX, scaleY };
}

export function canvasTransformCss(transform: CanvasElementTransform) {
  return `translate(${transform.x}cqw, ${transform.y * 9 / 16}cqw) scale(${transform.scaleX}, ${transform.scaleY}) rotate(${transform.rotation}deg)`;
}

export function mergeCanvasElementOverride(
  base: CanvasElementOverride | undefined,
  patch: Partial<CanvasElementOverride>,
  id: string,
): CanvasElementOverride {
  return {
    id,
    type: patch.type ?? base?.type ?? "group",
    ...base,
    ...patch,
    style: patch.style ? { ...base?.style, ...patch.style } : base?.style,
    transform: patch.transform ? { ...resolveCanvasTransform(base), ...patch.transform } : base?.transform,
  };
}
