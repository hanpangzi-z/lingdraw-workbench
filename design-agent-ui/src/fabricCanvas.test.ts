import { describe, expect, it, vi } from 'vitest'

import {
  cloneFabricClipboardShapes,
  convertTldrawSnapshot,
  FABRIC_CLIPBOARD_MIME,
  FabricEditor,
  isFabricTextEntryTarget,
  parseFabricClipboardShapes,
  isRedoKeyboardEvent,
  isSpacePanKeyboardEvent,
  isUndoKeyboardEvent,
  upgradeFabricSnapshotFromLegacy,
} from './fabricCanvas'

describe('Fabric canvas clipboard', () => {
  it('uses a dedicated clipboard MIME and safely parses copied shapes', () => {
    expect(FABRIC_CLIPBOARD_MIME).toBe('application/x-lingdraw-design-shapes')
    expect(parseFabricClipboardShapes('[{"id":"shape:1","type":"geo","x":1,"y":2,"props":{}}]')).toHaveLength(1)
    expect(parseFabricClipboardShapes('{broken')).toEqual([])
  })

  it('clones selected shapes with new ids, an offset, and remapped marker targets', () => {
    const ids = ['shape:image-copy', 'shape:marker-copy']
    const copies = cloneFabricClipboardShapes([{
      id: 'shape:image', type: 'design-image', x: 100, y: 200,
      props: { w: 320, h: 240, url: '/image.png', name: 'image', lineage: '{}' },
    }, {
      id: 'shape:marker', type: 'design-marker', x: 120, y: 220,
      props: {
        w: 28, h: 28, number: 1, label: '标题', targetShapeId: 'shape:image', targetName: 'image',
        xRatio: .2, yRatio: .3, recognitionStatus: 'recognized', recognitionDescription: '',
      },
    }], 24, () => ids.shift() || 'shape:fallback')

    expect(copies.map(shape => shape.id)).toEqual(['shape:image-copy', 'shape:marker-copy'])
    expect(copies[0]).toMatchObject({ x: 124, y: 224 })
    expect(copies[1]).toMatchObject({ x: 144, y: 244, props: { targetShapeId: 'shape:image-copy' } })
  })
})

describe('Fabric canvas snapshot migration', () => {
  it('converts legacy tldraw records without dropping custom design metadata', () => {
    const snapshot = {
      store: {
        'shape:image': {
          id: 'shape:image',
          typeName: 'shape',
          type: 'design-image',
          x: 120,
          y: 80,
          rotation: .25,
          props: {
            w: 640,
            h: 480,
            url: '/assets/poster.png',
            name: '海报',
            lineage: '{"assetId":"asset_1"}',
          },
        },
        'shape:marker': {
          id: 'shape:marker',
          typeName: 'shape',
          type: 'design-marker',
          x: 250,
          y: 160,
          props: {
            w: 28,
            h: 28,
            number: 1,
            label: '主标题',
            targetShapeId: 'shape:image',
            xRatio: .2,
            yRatio: .3,
          },
        },
      },
    }

    const migrated = convertTldrawSnapshot(snapshot)

    expect(migrated.version).toBe(2)
    expect(migrated.objects).toHaveLength(2)
    expect(migrated.objects[0]).toMatchObject({
      id: 'shape:image',
      type: 'design-image',
      x: 120,
      y: 80,
      rotation: .25,
      props: {
        url: '/assets/poster.png',
        lineage: '{"assetId":"asset_1"}',
      },
    })
    expect(migrated.objects[1]).toMatchObject({
      id: 'shape:marker',
      type: 'design-marker',
      props: {
        targetShapeId: 'shape:image',
        xRatio: .2,
        yRatio: .3,
      },
    })
  })

  it('flattens legacy rich text into editable Fabric text', () => {
    const migrated = convertTldrawSnapshot({
      store: {
        'shape:text': {
          id: 'shape:text',
          typeName: 'shape',
          type: 'text',
          x: 12,
          y: 24,
          props: {
            richText: {
              content: [
                { content: [{ text: '端午' }] },
                { content: [{ text: '安康' }] },
              ],
            },
          },
        },
      },
    })

    expect(migrated.objects[0]).toMatchObject({
      type: 'text',
      props: {
        text: '端午\n安康',
        w: 220,
        h: 52,
      },
    })
  })

  it('resolves native tldraw image assets and upgrades an already migrated snapshot', () => {
    const legacy = {
      store: {
        'asset:photo': {
          id: 'asset:photo',
          typeName: 'asset',
          type: 'image',
          props: {
            name: '参考图',
            src: 'data:image/png;base64,AAAA',
            w: 640,
            h: 480,
          },
        },
        'shape:photo': {
          id: 'shape:photo',
          typeName: 'shape',
          type: 'image',
          x: 40,
          y: 80,
          props: {
            assetId: 'asset:photo',
            w: 320,
            h: 240,
          },
        },
      },
    }

    const converted = convertTldrawSnapshot(legacy)
    expect(converted.objects[0]).toMatchObject({
      id: 'shape:photo',
      type: 'design-image',
      props: {
        url: 'data:image/png;base64,AAAA',
        name: '参考图',
      },
    })

    const upgraded = upgradeFabricSnapshotFromLegacy({
      version: 1,
      viewport: { x: 0, y: 0, z: 1 },
      objects: [{
        id: 'shape:photo',
        type: 'image',
        x: 120,
        y: 160,
        props: { assetId: 'asset:photo', w: 320, h: 240 },
      }],
    }, legacy)
    expect(upgraded).toMatchObject({
      version: 2,
      objects: [{
        id: 'shape:photo',
        type: 'design-image',
        x: 120,
        y: 160,
        props: {
          url: 'data:image/png;base64,AAAA',
          name: '参考图',
        },
      }],
    })
  })
})

describe('Fabric canvas transient space panning', () => {
  function createEditor() {
    const handlers = new Map<string, (event: any) => void>()
    const canvas = {
      selection: true,
      skipTargetFind: false,
      isDrawingMode: false,
      defaultCursor: 'default',
      hoverCursor: 'move',
      on: vi.fn((name: string, handler: (event: any) => void) => { handlers.set(name, handler) }),
      toObject: vi.fn(() => ({})),
      requestRenderAll: vi.fn(),
      setViewportTransform: vi.fn(),
    }
    return { editor: new FabricEditor(canvas as never), canvas, handlers }
  }

  it('pans with the left pointer while space is held and restores selection afterward', () => {
    const { editor, canvas, handlers } = createEditor()
    editor.setSpacePanActive(true)

    expect(canvas.selection).toBe(false)
    expect(canvas.skipTargetFind).toBe(true)
    expect(canvas.defaultCursor).toBe('grab')
    handlers.get('mouse:down')?.({ e: { button: 0, altKey: false, clientX: 20, clientY: 30 } })
    handlers.get('mouse:move')?.({ e: { clientX: 50, clientY: 70 } })
    expect(editor.getCamera()).toMatchObject({ x: 30, y: 40, z: 1 })
    expect(canvas.defaultCursor).toBe('grabbing')

    editor.setSpacePanActive(false)
    expect(canvas.selection).toBe(false)
    handlers.get('mouse:up')?.({})
    expect(canvas.selection).toBe(true)
    expect(canvas.skipTargetFind).toBe(false)
    expect(canvas.defaultCursor).toBe('default')
  })

  it('temporarily suspends drawing and cancels safely on window blur', () => {
    const { editor, canvas, handlers } = createEditor()
    editor.setCurrentTool('draw')
    editor.setSpacePanActive(true)
    expect(canvas.isDrawingMode).toBe(false)
    handlers.get('mouse:down')?.({ e: { button: 0, altKey: false, clientX: 0, clientY: 0 } })

    editor.cancelTransientPan()
    expect(canvas.isDrawingMode).toBe(true)
    expect(canvas.selection).toBe(false)
    expect(canvas.skipTargetFind).toBe(false)
    expect(canvas.defaultCursor).toBe('crosshair')
  })

  it('recognizes space shortcuts without stealing input text', () => {
    const textarea = document.createElement('textarea')
    const canvas = document.createElement('div')
    expect(isSpacePanKeyboardEvent({ code: 'Space', key: ' ' } as KeyboardEvent)).toBe(true)
    expect(isSpacePanKeyboardEvent({ code: 'KeyV', key: 'v' } as KeyboardEvent)).toBe(false)
    expect(isFabricTextEntryTarget(textarea)).toBe(true)
    expect(isFabricTextEntryTarget(canvas)).toBe(false)
  })

  it('recognizes undo and redo keyboard shortcuts', () => {
    expect(isUndoKeyboardEvent({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: false })).toBe(true)
    expect(isUndoKeyboardEvent({ key: 'Z', ctrlKey: false, metaKey: true, shiftKey: false })).toBe(true)
    expect(isRedoKeyboardEvent({ key: 'z', ctrlKey: true, metaKey: false, shiftKey: true })).toBe(true)
    expect(isRedoKeyboardEvent({ key: 'y', ctrlKey: true, metaKey: false, shiftKey: false })).toBe(true)
  })
})
