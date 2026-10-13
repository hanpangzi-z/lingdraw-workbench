import { describe, expect, it } from 'vitest'
import { computeImageOverlayPlacement } from './imageOverlay'

const viewport = { width: 1200, height: 900 }
const toolbar = { width: 720, height: 44 }

describe('computeImageOverlayPlacement', () => {
  it('prefers the image bottom edge when the action bar has room', () => {
    const placement = computeImageOverlayPlacement({
      image: { left: 300, top: 150, right: 800, bottom: 500 },
      viewport,
      toolbar,
    })

    expect(placement?.toolbar).toEqual({ left: 190, top: 524, side: 'below' })
    expect(placement?.meta).toEqual({ left: 300, top: 130, width: 500 })
  })

  it('flips above when the global bottom controls leave no room below', () => {
    const placement = computeImageOverlayPlacement({
      image: { left: 240, top: 180, right: 960, bottom: 790 },
      viewport,
      toolbar,
    })

    expect(placement?.toolbar).toEqual({ left: 240, top: 126, side: 'above' })
  })

  it('keeps following the bottom edge when the image top is outside the viewport', () => {
    const placement = computeImageOverlayPlacement({
      image: { left: 80, top: -38, right: 530, bottom: 410 },
      viewport,
      toolbar,
    })

    expect(placement?.toolbar?.top).toBe(434)
    expect(placement?.toolbar?.side).toBe('below')
    expect(placement?.meta.top).toBe(-58)
  })

  it('clamps only the toolbar horizontally', () => {
    const left = computeImageOverlayPlacement({
      image: { left: -100, top: 150, right: 350, bottom: 500 },
      viewport,
      toolbar,
    })
    const right = computeImageOverlayPlacement({
      image: { left: 950, top: 150, right: 1400, bottom: 500 },
      viewport,
      toolbar,
    })

    expect(left?.toolbar?.left).toBe(16)
    expect(left?.meta.left).toBe(-100)
    expect(right?.toolbar?.left).toBe(464)
    expect(right?.meta.left).toBe(950)
  })

  it('hides all selected-image chrome once the image fully leaves the viewport', () => {
    expect(computeImageOverlayPlacement({
      image: { left: 100, top: -500, right: 500, bottom: -1 },
      viewport,
      toolbar,
    })).toBeNull()
  })

  it('does not pin the action bar when neither image edge has room', () => {
    const placement = computeImageOverlayPlacement({
      image: { left: 150, top: 40, right: 1050, bottom: 850 },
      viewport,
      toolbar,
    })

    expect(placement?.toolbar).toBeNull()
  })
})
