export type ExpansionDirection = 'all' | 'left' | 'right' | 'top' | 'bottom'
export type ExpansionAmount = 0.25 | 0.5 | 1
export type ExpansionResolutionScale = 1 | 2
export type ExpansionHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
export type ExpansionPadding = {
  top: number
  right: number
  bottom: number
  left: number
}

export type ExpansionGeometry = {
  sourceWidth: number
  sourceHeight: number
  width: number
  height: number
  offsetX: number
  offsetY: number
  padding: ExpansionPadding
}

export type ExpansionOutput = {
  width: number
  height: number
  size: string
  sourceRect: {
    x: number
    y: number
    width: number
    height: number
  }
}

const positiveDimension = (value: number) => Math.max(1, Math.round(Number(value) || 1))
const multipleOf16 = (value: number) => Math.max(16, Math.round(value / 16) * 16)
const nonNegativeDimension = (value: number) => Math.max(0, Math.round(Number(value) || 0))

export function computeExpansionGeometryFromPadding(
  sourceWidth: number,
  sourceHeight: number,
  value: ExpansionPadding,
): ExpansionGeometry {
  const width = positiveDimension(sourceWidth)
  const height = positiveDimension(sourceHeight)
  const padding = {
    top: nonNegativeDimension(value.top),
    right: nonNegativeDimension(value.right),
    bottom: nonNegativeDimension(value.bottom),
    left: nonNegativeDimension(value.left),
  }
  return {
    sourceWidth: width,
    sourceHeight: height,
    width: width + padding.left + padding.right,
    height: height + padding.top + padding.bottom,
    offsetX: padding.left,
    offsetY: padding.top,
    padding,
  }
}

export function computeExpansionGeometry(
  sourceWidth: number,
  sourceHeight: number,
  direction: ExpansionDirection,
  amount: ExpansionAmount,
): ExpansionGeometry {
  const width = positiveDimension(sourceWidth)
  const height = positiveDimension(sourceHeight)
  const horizontal = Math.max(1, Math.round(width * amount))
  const vertical = Math.max(1, Math.round(height * amount))
  const padding = { top: 0, right: 0, bottom: 0, left: 0 }

  if (direction === 'all') {
    padding.left = Math.floor(horizontal / 2)
    padding.right = horizontal - padding.left
    padding.top = Math.floor(vertical / 2)
    padding.bottom = vertical - padding.top
  } else if (direction === 'left') {
    padding.left = horizontal
  } else if (direction === 'right') {
    padding.right = horizontal
  } else if (direction === 'top') {
    padding.top = vertical
  } else {
    padding.bottom = vertical
  }

  return computeExpansionGeometryFromPadding(width, height, padding)
}

export function resizeExpansionPadding(
  initial: ExpansionPadding,
  handle: ExpansionHandle,
  deltaX: number,
  deltaY: number,
  sourceWidth: number,
  sourceHeight: number,
): ExpansionPadding {
  const horizontalLimit = positiveDimension(sourceWidth) * 2
  const verticalLimit = positiveDimension(sourceHeight) * 2
  const clamp = (value: number, limit: number) => Math.max(0, Math.min(limit, Math.round(value)))
  const next = { ...initial }
  if (handle.includes('w')) next.left = clamp(initial.left - deltaX, horizontalLimit)
  if (handle.includes('e')) next.right = clamp(initial.right + deltaX, horizontalLimit)
  if (handle.includes('n')) next.top = clamp(initial.top - deltaY, verticalLimit)
  if (handle.includes('s')) next.bottom = clamp(initial.bottom + deltaY, verticalLimit)
  return next
}

export function expansionPaddingForAspectRatio(
  sourceWidth: number,
  sourceHeight: number,
  aspectRatio: number,
  frameScale = 1.25,
): ExpansionPadding {
  const width = positiveDimension(sourceWidth)
  const height = positiveDimension(sourceHeight)
  const ratio = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : width / height
  let frameWidth = width * Math.max(1, frameScale)
  let frameHeight = height * Math.max(1, frameScale)
  if (frameWidth / frameHeight < ratio) frameWidth = frameHeight * ratio
  else frameHeight = frameWidth / ratio
  const horizontal = Math.max(0, Math.round(frameWidth - width))
  const vertical = Math.max(0, Math.round(frameHeight - height))
  return {
    left: Math.floor(horizontal / 2),
    right: horizontal - Math.floor(horizontal / 2),
    top: Math.floor(vertical / 2),
    bottom: vertical - Math.floor(vertical / 2),
  }
}

export function chooseExpansionOutput(
  geometry: ExpansionGeometry,
  resolutionScale: ExpansionResolutionScale = 1,
): ExpansionOutput {
  const maxEdge = resolutionScale === 2 ? 3840 : 2048
  const minPixels = 1024 * 1024
  const rawArea = geometry.width * geometry.height
  let scale = Math.min(1, maxEdge / Math.max(geometry.width, geometry.height))

  if (rawArea * scale * scale < minPixels) {
    scale = Math.min(maxEdge / Math.max(geometry.width, geometry.height), Math.sqrt(minPixels / rawArea))
  }

  const width = multipleOf16(geometry.width * scale)
  const height = multipleOf16(geometry.height * scale)
  const scaleX = width / geometry.width
  const scaleY = height / geometry.height

  return {
    width,
    height,
    size: `${width}x${height}`,
    sourceRect: {
      x: Math.round(geometry.offsetX * scaleX),
      y: Math.round(geometry.offsetY * scaleY),
      width: Math.round(geometry.sourceWidth * scaleX),
      height: Math.round(geometry.sourceHeight * scaleY),
    },
  }
}

export function expansionPreviewRect(
  image: { left: number; top: number; width: number; height: number },
  geometry: ExpansionGeometry,
) {
  const scaleX = image.width / geometry.sourceWidth
  const scaleY = image.height / geometry.sourceHeight
  return {
    left: image.left - geometry.padding.left * scaleX,
    top: image.top - geometry.padding.top * scaleY,
    width: geometry.width * scaleX,
    height: geometry.height * scaleY,
  }
}
