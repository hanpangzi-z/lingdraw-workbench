export type ImageViewportBounds = {
  left: number
  top: number
  right: number
  bottom: number
}

export type ImageOverlayPlacement = {
  meta: {
    left: number
    top: number
    width: number
  }
  toolbar: {
    left: number
    top: number
    side: 'above' | 'below'
  } | null
}

type ComputeImageOverlayPlacementOptions = {
  image: ImageViewportBounds
  viewport: { width: number; height: number }
  toolbar: { width: number; height: number }
  sideInset?: number
  topInset?: number
  bottomInset?: number
  gapAbove?: number
  gapBelow?: number
}

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum))

/**
 * Positions the selected-image controls like Lovart's canvas UI:
 * the label stays attached to the image, while the action bar prefers the
 * bottom edge, flips above when necessary, and never sticks to a viewport
 * edge after the image has left the canvas.
 */
export function computeImageOverlayPlacement({
  image,
  viewport,
  toolbar,
  sideInset = 16,
  topInset = 62,
  bottomInset = 86,
  gapAbove = 10,
  gapBelow = 24,
}: ComputeImageOverlayPlacementOptions): ImageOverlayPlacement | null {
  const imageWidth = Math.max(0, image.right - image.left)
  const intersectsViewport = image.right > 0
    && image.left < viewport.width
    && image.bottom > 0
    && image.top < viewport.height

  if (!intersectsViewport || imageWidth === 0 || viewport.width <= 0 || viewport.height <= 0) return null

  const availableToolbarWidth = Math.max(0, viewport.width - sideInset * 2)
  const toolbarWidth = Math.min(Math.max(0, toolbar.width), availableToolbarWidth)
  const toolbarHeight = Math.max(0, toolbar.height)
  const safeBottom = viewport.height - bottomInset
  const belowTop = image.bottom + gapBelow
  const aboveTop = image.top - toolbarHeight - gapAbove
  let toolbarPlacement: ImageOverlayPlacement['toolbar'] = null

  if (toolbarWidth > 0 && toolbarHeight > 0) {
    const centeredLeft = (image.left + image.right - toolbarWidth) / 2
    const toolbarLeft = clamp(centeredLeft, sideInset, viewport.width - sideInset - toolbarWidth)
    if (belowTop >= topInset && belowTop + toolbarHeight <= safeBottom) {
      toolbarPlacement = { left: toolbarLeft, top: belowTop, side: 'below' }
    } else if (aboveTop >= topInset && aboveTop + toolbarHeight <= safeBottom) {
      toolbarPlacement = { left: toolbarLeft, top: aboveTop, side: 'above' }
    }
  }

  return {
    meta: {
      left: image.left,
      top: image.top - 20,
      width: imageWidth,
    },
    toolbar: toolbarPlacement,
  }
}
