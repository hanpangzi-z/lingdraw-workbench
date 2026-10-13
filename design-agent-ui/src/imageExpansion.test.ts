import { describe, expect, it } from 'vitest'
import {
  chooseExpansionOutput,
  computeExpansionGeometry,
  computeExpansionGeometryFromPadding,
  expansionPaddingForAspectRatio,
  expansionPreviewRect,
  resizeExpansionPadding,
} from './imageExpansion'

describe('image expansion geometry', () => {
  it('adds equal space around all four sides', () => {
    const geometry = computeExpansionGeometry(1000, 800, 'all', 0.5)
    expect(geometry).toMatchObject({
      width: 1500,
      height: 1200,
      offsetX: 250,
      offsetY: 200,
      padding: { left: 250, right: 250, top: 200, bottom: 200 },
    })
  })

  it('keeps the source anchored while expanding one side', () => {
    expect(computeExpansionGeometry(1000, 800, 'right', 0.5)).toMatchObject({
      width: 1500,
      height: 800,
      offsetX: 0,
      offsetY: 0,
      padding: { left: 0, right: 500, top: 0, bottom: 0 },
    })
    expect(computeExpansionGeometry(1000, 800, 'top', 0.25)).toMatchObject({
      width: 1000,
      height: 1000,
      offsetX: 0,
      offsetY: 200,
    })
  })

  it('chooses a valid output size and maps the original into it', () => {
    const geometry = computeExpansionGeometry(1440, 1440, 'right', 0.5)
    const output = chooseExpansionOutput(geometry)
    expect(output.width % 16).toBe(0)
    expect(output.height % 16).toBe(0)
    expect(output.width).toBeLessThanOrEqual(2048)
    expect(output.height).toBeLessThanOrEqual(2048)
    expect(output.sourceRect.x).toBe(0)
    expect(output.sourceRect.width).toBeLessThan(output.width)
  })

  it('projects the expanded bounds around the visible image', () => {
    const geometry = computeExpansionGeometry(1000, 800, 'all', 0.5)
    expect(expansionPreviewRect({ left: 300, top: 200, width: 500, height: 400 }, geometry)).toEqual({
      left: 175,
      top: 100,
      width: 750,
      height: 600,
    })
  })

  it('supports asymmetric padding created by direct dragging', () => {
    expect(computeExpansionGeometryFromPadding(1000, 800, {
      left: 120,
      right: 340,
      top: 80,
      bottom: 0,
    })).toMatchObject({
      width: 1460,
      height: 880,
      offsetX: 120,
      offsetY: 80,
    })
  })

  it('resizes individual edges and corners without shrinking inside the source', () => {
    const initial = { left: 100, right: 100, top: 100, bottom: 100 }
    expect(resizeExpansionPadding(initial, 'se', 75, 50, 1000, 800)).toEqual({
      left: 100,
      right: 175,
      top: 100,
      bottom: 150,
    })
    expect(resizeExpansionPadding(initial, 'nw', 160, 140, 1000, 800)).toEqual({
      left: 0,
      right: 100,
      top: 0,
      bottom: 100,
    })
  })

  it('creates a centered frame for common aspect ratios', () => {
    const padding = expansionPaddingForAspectRatio(1200, 800, 1, 1.25)
    const geometry = computeExpansionGeometryFromPadding(1200, 800, padding)
    expect(geometry.width).toBe(1500)
    expect(geometry.height).toBe(1500)
    expect(Math.abs(padding.left - padding.right)).toBeLessThanOrEqual(1)
    expect(Math.abs(padding.top - padding.bottom)).toBeLessThanOrEqual(1)
  })

  it('keeps the original aspect at the original bounds until the user expands it', () => {
    expect(expansionPaddingForAspectRatio(1200, 800, 1.5, 1)).toEqual({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    })
  })

  it('supports a larger 2x output ceiling', () => {
    const geometry = computeExpansionGeometry(2400, 1600, 'right', 0.5)
    const output = chooseExpansionOutput(geometry, 2)
    expect(output.width).toBeGreaterThan(2048)
    expect(output.width).toBeLessThanOrEqual(3840)
    expect(output.height).toBeLessThanOrEqual(3840)
  })
})
