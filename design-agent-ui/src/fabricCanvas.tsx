import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActiveSelection,
  Canvas,
  Circle,
  FabricImage,
  FabricObject,
  Group,
  IText,
  Path,
  PencilBrush,
  Point,
  Rect,
  Text,
} from 'fabric'
import {
  DesignGeneratorCard,
  type CanvasShapeRecord,
  type DesignGeneratorShape,
  type DesignImageShape,
  type DesignMarkerShape,
  type GenerationPlaceholderShape,
} from './canvasShapes'

export type TLShapeId = string
export type TLShape = CanvasShapeRecord
type PointLike = { x: number; y: number }
type Camera = { x: number; y: number; z: number }
type Bounds = {
  x: number
  y: number
  w: number
  h: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  center: PointLike
}
type ListenOptions = { scope?: 'document'; source?: 'user' }
type Listener = { callback: () => void; options?: ListenOptions }
type SnapshotEnvelope = { document?: unknown; session?: unknown }
type FabricSnapshot = {
  version: 1 | 2
  objects: CanvasShapeRecord[]
  viewport: Camera
  fabric_json?: Record<string, unknown>
}

type ShapeInput<TShape extends TLShape = TLShape> = Omit<TShape, 'rotation' | 'parentId'> & {
  rotation?: number
  parentId?: string
  isLocked?: boolean
}
type ShapeUpdate<TShape extends TLShape = TLShape> =
  Partial<Omit<TShape, 'id' | 'props'>>
  & Pick<TShape, 'id'>
  & { props?: Partial<TShape['props']> }

function numeric(value: unknown, fallback = 0) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

export function isFabricTextEntryTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && Boolean(target.closest('input, textarea, select, [contenteditable=true]'))
}

export function isSpacePanKeyboardEvent(event: Pick<KeyboardEvent, 'code' | 'key'>) {
  return event.code === 'Space' || event.key === ' '
}

export function isUndoKeyboardEvent(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>) {
  return (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z'
}

export function isRedoKeyboardEvent(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey'>) {
  return (event.ctrlKey || event.metaKey) && (
    (event.shiftKey && event.key.toLowerCase() === 'z')
    || (!event.shiftKey && event.key.toLowerCase() === 'y')
  )
}

function cloneShape<T extends TLShape>(shape: T): T {
  return structuredClone(shape)
}

export function createShapeId() {
  return `shape:${crypto.randomUUID()}`
}

export function cloneFabricClipboardShapes(
  shapes: TLShape[],
  offset = 24,
  makeId: () => string = createShapeId,
) {
  const idMap = new Map(shapes.map(shape => [shape.id, makeId()]))
  return shapes.map(shape => {
    const copy = cloneShape(shape)
    copy.id = idMap.get(shape.id) || makeId()
    copy.x = numeric(shape.x) + offset
    copy.y = numeric(shape.y) + offset
    if (copy.parentId && idMap.has(copy.parentId)) copy.parentId = idMap.get(copy.parentId)
    const targetShapeId = String((copy.props as { targetShapeId?: string }).targetShapeId || '')
    if (targetShapeId && idMap.has(targetShapeId)) {
      copy.props = { ...copy.props, targetShapeId: idMap.get(targetShapeId) }
    }
    return copy
  })
}

export const FABRIC_CLIPBOARD_MIME = 'application/x-lingdraw-design-shapes'
export const FABRIC_CLIPBOARD_TEXT = 'LingDraw design objects'

export function parseFabricClipboardShapes(value: string) {
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((shape): shape is TLShape => Boolean(
      shape && typeof shape === 'object'
      && typeof shape.id === 'string'
      && typeof shape.type === 'string'
      && shape.props && typeof shape.props === 'object',
    ))
  } catch {
    return []
  }
}

function shapeSize(shape: TLShape) {
  const props = shape.props as { w?: number; h?: number }
  return { w: Math.max(1, numeric(props.w, 160)), h: Math.max(1, numeric(props.h, 120)) }
}

function isImageShape(shape: TLShape): shape is DesignImageShape {
  return shape.type === 'design-image'
}

function isGeneratorShape(shape: TLShape): shape is DesignGeneratorShape {
  return shape.type === 'design-generator'
}

function isMarkerShape(shape: TLShape): shape is DesignMarkerShape {
  return shape.type === 'design-marker'
}

function isPlaceholderShape(shape: TLShape): shape is GenerationPlaceholderShape {
  return shape.type === 'generation-placeholder'
}

function legacyRichText(props: Record<string, unknown>) {
  if (typeof props.text === 'string' && props.text) return props.text
  const richText = props.richText as { content?: Array<{ content?: Array<{ text?: string }> }> } | undefined
  return richText?.content?.flatMap(paragraph => paragraph.content || []).map(item => item.text || '').join('\n') || '文字'
}

export function convertTldrawSnapshot(snapshot: unknown): FabricSnapshot {
  const records: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  const collect = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(collect)
      return
    }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : ''
    if (id && !seen.has(id) && (record.typeName === 'shape' || record.typeName === 'asset')) {
      seen.add(id)
      records.push(record)
    }
    Object.values(record).forEach(collect)
  }
  collect(snapshot)
  const imageAssets = new Map<string, Record<string, unknown>>()
  for (const record of records) {
    if (record.typeName !== 'asset' || record.type !== 'image' || typeof record.id !== 'string') continue
    imageAssets.set(
      record.id,
      structuredClone((record.props && typeof record.props === 'object' ? record.props : {}) as Record<string, unknown>),
    )
  }
  const shapes: CanvasShapeRecord[] = []
  for (const record of records) {
    if (record.typeName !== 'shape' || typeof record.id !== 'string' || typeof record.type !== 'string') continue
    let type = record.type
    const props = structuredClone((record.props && typeof record.props === 'object' ? record.props : {}) as Record<string, unknown>)
    if (type === 'text') {
      props.text = legacyRichText(props)
      props.w = numeric(props.w, 220)
      props.h = numeric(props.h, 52)
    } else if (type === 'image') {
      const asset = imageAssets.get(String(props.assetId || ''))
      const url = String(props.url || asset?.src || '')
      if (url) {
        type = 'design-image'
        props.url = url
        props.name = String(asset?.name || props.altText || '迁移图片')
        props.lineage = JSON.stringify({
          source: 'tldraw-migration',
          assetId: String(props.assetId || ''),
        })
      }
    } else if (type === 'draw' && !props.path && Array.isArray(props.segments)) {
      const commands: string[] = []
      for (const segment of props.segments as Array<{ points?: Array<{ x?: number; y?: number }> }>) {
        const points = Array.isArray(segment?.points) ? segment.points : []
        points.forEach((point, index) => {
          commands.push(`${index === 0 ? 'M' : 'L'} ${numeric(point.x)} ${numeric(point.y)}`)
        })
      }
      if (commands.length) props.path = commands.join(' ')
    }
    shapes.push({
      id: record.id,
      type,
      x: numeric(record.x),
      y: numeric(record.y),
      rotation: numeric(record.rotation),
      parentId: typeof record.parentId === 'string' ? record.parentId : undefined,
      props,
    })
  }
  return {
    version: 2,
    objects: shapes,
    viewport: { x: 0, y: 0, z: 1 },
  }
}

export function upgradeFabricSnapshotFromLegacy(current: unknown, legacy: unknown) {
  const snapshot = isFabricSnapshot(current) ? current : convertTldrawSnapshot(current)
  if (snapshot.version >= 2) return snapshot
  const legacyById = new Map(convertTldrawSnapshot(legacy).objects.map(shape => [shape.id, shape]))
  const objects = snapshot.objects.map(shape => {
    const migrated = legacyById.get(shape.id)
    const shouldEnrichImage = shape.type === 'image' && migrated?.type === 'design-image'
    const shouldEnrichDraw = shape.type === 'draw'
      && typeof (migrated?.props as { path?: unknown } | undefined)?.path === 'string'
      && typeof (shape.props as { path?: unknown }).path !== 'string'
    if (!migrated || (!shouldEnrichImage && !shouldEnrichDraw)) return shape
    return {
      ...shape,
      type: migrated.type,
      props: {
        ...migrated.props,
        ...shape.props,
        ...(shouldEnrichImage ? {
          url: (migrated.props as DesignImageShape['props']).url,
          name: (migrated.props as DesignImageShape['props']).name,
          lineage: (migrated.props as DesignImageShape['props']).lineage,
        } : {}),
        ...(shouldEnrichDraw ? { path: (migrated.props as { path: string }).path } : {}),
      },
    } as CanvasShapeRecord
  })
  return { ...snapshot, version: 2 as const, objects }
}

export class FabricEditor {
  readonly store: {
    listen: (callback: () => void, options?: ListenOptions) => () => void
    editor: FabricEditor
  }

  private canvas: Canvas
  private shapes = new Map<TLShapeId, TLShape>()
  private objects = new Map<TLShapeId, FabricObject>()
  private listeners = new Set<Listener>()
  private currentTool = 'select'
  private spacePanActive = false
  private pointerPanning = false
  private camera: Camera = { x: 0, y: 0, z: 1 }
  private suppressDocumentEvents = 0
  private history: FabricSnapshot[] = []
  private historyIndex = -1
  private historyTimer = 0
  private pendingSelectionIds: TLShapeId[] = []
  private disposed = false

  constructor(canvas: Canvas) {
    this.canvas = canvas
    this.store = {
      editor: this,
      listen: (callback, options) => {
        const listener = { callback, options }
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      },
    }
    this.bindCanvasEvents()
    this.pushHistory()
  }

  dispose() {
    this.disposed = true
    if (this.historyTimer) window.clearTimeout(this.historyTimer)
    this.listeners.clear()
    this.canvas.dispose()
  }

  private bindCanvasEvents() {
    const selectionChanged = () => this.emitUi()
    this.canvas.on('selection:created', selectionChanged)
    this.canvas.on('selection:updated', selectionChanged)
    this.canvas.on('selection:cleared', selectionChanged)
    this.canvas.on('object:moving', event => {
      if (event.target) this.readObjectTransform(event.target)
      this.emitUi()
    })
    this.canvas.on('object:scaling', event => {
      if (event.target) this.readObjectTransform(event.target)
      this.emitUi()
    })
    this.canvas.on('object:rotating', event => {
      if (event.target) this.readObjectTransform(event.target)
      this.emitUi()
    })
    this.canvas.on('object:modified', event => {
      if (event.target) this.readObjectTransform(event.target, true)
      this.emitDocument()
    })
    this.canvas.on('text:changed', event => {
      const object = event.target
      if (!(object instanceof IText)) return
      const id = String(((object as FabricObject & { data?: { shapeId?: string } }).data)?.shapeId || '')
      const shape = this.shapes.get(id)
      if (!shape || shape.type !== 'text') return
      shape.props = { ...shape.props, text: object.text || '' }
      this.shapes.set(id, shape)
      this.emitDocument()
    })
    this.canvas.on('path:created', event => {
      const path = event.path
      const id = createShapeId()
      path.set({ data: { shapeId: id }, objectCaching: false })
      const bounds = path.getBoundingRect()
      const shape: TLShape = {
        id,
        type: 'draw',
        x: bounds.left,
        y: bounds.top,
        rotation: 0,
        props: {
          w: Math.max(1, bounds.width),
          h: Math.max(1, bounds.height),
          path: path.toObject(),
        },
      }
      this.shapes.set(id, shape)
      this.objects.set(id, path)
      this.emitDocument()
    })
    this.canvas.on('mouse:wheel', event => {
      event.e.preventDefault()
      event.e.stopPropagation()
      const next = Math.min(4, Math.max(.08, this.camera.z * Math.pow(.999, event.e.deltaY)))
      const rect = this.canvas.getElement().getBoundingClientRect()
      this.zoomAt({ x: event.e.clientX - rect.left, y: event.e.clientY - rect.top }, next)
    })
    let last = { x: 0, y: 0 }
    this.canvas.on('mouse:down', event => {
      const pointer = event.e as MouseEvent
      if (pointer.button === 1 || pointer.altKey || this.currentTool === 'hand' || this.spacePanActive) {
        this.pointerPanning = true
        last = { x: pointer.clientX, y: pointer.clientY }
        this.canvas.selection = false
        this.updateCanvasCursor()
        return
      }
      if (event.target || !['geo', 'text'].includes(this.currentTool)) return
      const page = this.screenToPage({ x: pointer.clientX, y: pointer.clientY })
      if (this.currentTool === 'geo') {
        const id = createShapeId()
        this.createShape({
          id,
          type: 'geo',
          x: page.x - 80,
          y: page.y - 60,
          props: { w: 160, h: 120, fill: '#ffffff', stroke: '#111827' },
        })
        this.select(id)
        this.setCurrentTool('select')
      } else {
        const id = createShapeId()
        this.createShape({
          id,
          type: 'text',
          x: page.x,
          y: page.y,
          props: { w: 220, h: 52, text: '输入文字', fill: '#111827' },
        })
        this.select(id)
        const object = this.objects.get(id)
        if (object instanceof IText) {
          object.enterEditing()
          object.selectAll()
        }
        this.setCurrentTool('select')
      }
    })
    this.canvas.on('mouse:move', event => {
      if (!this.pointerPanning) return
      const pointer = event.e as MouseEvent
      const dx = pointer.clientX - last.x
      const dy = pointer.clientY - last.y
      last = { x: pointer.clientX, y: pointer.clientY }
      this.setCamera({ x: this.camera.x + dx / this.camera.z, y: this.camera.y + dy / this.camera.z, z: this.camera.z })
    })
    this.canvas.on('mouse:up', () => {
      if (!this.pointerPanning) return
      this.pointerPanning = false
      this.canvas.skipTargetFind = this.spacePanActive || this.currentTool === 'hand'
      this.canvas.selection = this.currentTool === 'select' && !this.spacePanActive
      this.updateCanvasCursor()
      this.emitUi()
    })
  }

  private readObjectTransform(object: FabricObject, finalize = false) {
    if (object instanceof ActiveSelection) {
      for (const child of object.getObjects()) {
        const id = String(((child as FabricObject & { data?: { shapeId?: string } }).data)?.shapeId || '')
        const shape = this.shapes.get(id)
        if (!shape || isMarkerShape(shape)) continue
        const bounds = child.getBoundingRect()
        shape.x = bounds.left
        shape.y = bounds.top
        shape.rotation = numeric(child.getTotalAngle()) * Math.PI / 180
        shape.props = { ...shape.props, w: Math.max(1, bounds.width), h: Math.max(1, bounds.height) }
        this.shapes.set(id, shape)
      }
      return
    }
    const id = String(((object as FabricObject & { data?: { shapeId?: string } }).data)?.shapeId || '')
    const shape = this.shapes.get(id)
    if (!shape || isMarkerShape(shape)) return
    const width = Math.max(1, object.getScaledWidth())
    const height = Math.max(1, object.getScaledHeight())
    shape.x = numeric(object.left)
    shape.y = numeric(object.top)
    shape.rotation = numeric(object.angle) * Math.PI / 180
    shape.props = { ...shape.props, w: width, h: height }
    if (finalize && !(object instanceof FabricImage)) {
      object.set({ scaleX: 1, scaleY: 1, width, height })
      object.setCoords()
    }
    this.shapes.set(id, shape)
  }

  private emitUi() {
    if (this.disposed) return
    for (const listener of this.listeners) {
      if (!listener.options?.scope) listener.callback()
    }
  }

  private emitDocument() {
    if (this.disposed || this.suppressDocumentEvents) {
      this.emitUi()
      return
    }
    this.scheduleHistory()
    for (const listener of this.listeners) listener.callback()
  }

  private scheduleHistory() {
    if (this.historyTimer) window.clearTimeout(this.historyTimer)
    this.historyTimer = window.setTimeout(() => {
      this.historyTimer = 0
      this.pushHistory()
    }, 80)
  }

  private pushHistory() {
    const next = this.snapshot()
    const serialized = JSON.stringify(next)
    if (this.historyIndex >= 0 && JSON.stringify(this.history[this.historyIndex]) === serialized) return
    this.history = this.history.slice(0, this.historyIndex + 1)
    this.history.push(next)
    if (this.history.length > 80) this.history.shift()
    this.historyIndex = this.history.length - 1
  }

  private objectOptions(shape: TLShape) {
    const { w, h } = shapeSize(shape)
    return {
      left: shape.x,
      top: shape.y,
      width: w,
      height: h,
      angle: numeric(shape.rotation) * 180 / Math.PI,
      originX: 'left' as const,
      originY: 'top' as const,
      transparentCorners: false,
      cornerColor: '#ffffff',
      cornerStrokeColor: '#3b82f6',
      borderColor: '#3b82f6',
      cornerSize: 10,
      data: { shapeId: shape.id },
    }
  }

  private async buildObject(shape: TLShape): Promise<FabricObject> {
    const options = this.objectOptions(shape)
    if (isImageShape(shape)) {
      try {
        const image = await FabricImage.fromURL(shape.props.url, { crossOrigin: 'anonymous' })
        const sourceWidth = Math.max(1, numeric(image.width, shape.props.w))
        const sourceHeight = Math.max(1, numeric(image.height, shape.props.h))
        image.set({
          ...options,
          width: sourceWidth,
          height: sourceHeight,
          scaleX: shape.props.w / sourceWidth,
          scaleY: shape.props.h / sourceHeight,
        })
        return image
      } catch {
        return new Rect({ ...options, fill: '#f3f4f6', stroke: '#ef4444', strokeWidth: 1 })
      }
    }
    if (isGeneratorShape(shape)) {
      if (shape.props.status === 'result' && shape.props.resultUrl) {
        try {
          const image = await FabricImage.fromURL(shape.props.resultUrl, { crossOrigin: 'anonymous' })
          const sourceWidth = Math.max(1, numeric(image.width, shape.props.w))
          const sourceHeight = Math.max(1, numeric(image.height, shape.props.h))
          image.set({
            ...options,
            width: sourceWidth,
            height: sourceHeight,
            scaleX: shape.props.w / sourceWidth,
            scaleY: shape.props.h / sourceHeight,
          })
          return image
        } catch {
          return new Rect({ ...options, fill: '#f3f4f6', stroke: '#ef4444', strokeWidth: 1 })
        }
      }
      return new Rect({ ...options, fill: 'rgba(255,255,255,0.001)', strokeWidth: 0 })
    }
    if (isMarkerShape(shape)) {
      const circle = new Circle({ radius: 13, fill: '#3b82f6', stroke: '#ffffff', strokeWidth: 2, originX: 'center', originY: 'center' })
      const number = new Text(String(shape.props.number), { fontSize: 13, fill: '#ffffff', fontWeight: '700', originX: 'center', originY: 'center' })
      return new Group([circle, number], {
        ...options,
        width: shape.props.w,
        height: shape.props.h,
        selectable: false,
        evented: false,
        objectCaching: false,
      })
    }
    if (isPlaceholderShape(shape)) {
      const rect = new Rect({
        width: shape.props.w,
        height: shape.props.h,
        fill: shape.props.status === 'failed' ? '#fff1f2' : '#f2f3ff',
        stroke: shape.props.status === 'failed' ? '#fca5a5' : '#d8dbff',
        strokeWidth: 1,
        rx: 12,
        ry: 12,
        originX: 'left',
        originY: 'top',
      })
      const label = new Text(shape.props.label, {
        left: shape.props.w / 2,
        top: shape.props.h / 2,
        originX: 'center',
        originY: 'center',
        fontSize: 18,
        fill: shape.props.status === 'failed' ? '#b91c1c' : '#5b5f79',
      })
      return new Group([rect, label], { ...options, objectCaching: false })
    }
    if (shape.type === 'text') {
      const props = shape.props as { text?: string; fill?: string; w?: number; h?: number }
      return new IText(props.text || '文字', {
        ...options,
        fill: props.fill || '#111827',
        fontFamily: 'Inter, Microsoft YaHei, sans-serif',
        fontSize: Math.max(18, numeric((shape.props as { fontSize?: number }).fontSize, 34)),
      })
    }
    if (shape.type === 'draw') {
      const props = shape.props as { path?: string | Record<string, unknown> }
      if (props.path) {
        try {
          const path = typeof props.path === 'string' ? props.path : props.path.path
          return new Path(path as never, { ...options })
        } catch {
          // Older snapshots may not contain a Fabric path. Keep a selectable placeholder.
        }
      }
    }
    const props = shape.props as { fill?: string; stroke?: string }
    return new Rect({
      ...options,
      fill: props.fill || '#ffffff',
      stroke: props.stroke || '#111827',
      strokeWidth: 2,
      rx: 0,
      ry: 0,
    })
  }

  private async materialize(shape: TLShape, emit = true) {
    const object = await this.buildObject(shape)
    if (this.shapes.get(shape.id) !== shape && !this.shapes.has(shape.id)) return
    const previous = this.objects.get(shape.id)
    if (previous) this.canvas.remove(previous)
    this.objects.set(shape.id, object)
    this.canvas.add(object)
    if (isMarkerShape(shape)) this.canvas.bringObjectToFront(object)
    this.canvas.requestRenderAll()
    if (
      this.pendingSelectionIds.includes(shape.id)
      && this.pendingSelectionIds.every(id => this.objects.has(id))
    ) {
      const pending = [...this.pendingSelectionIds]
      this.pendingSelectionIds = []
      this.select(...pending)
    }
    if (emit) this.emitDocument()
  }

  createShape<TShape extends TLShape = TLShape>(input: ShapeInput<TShape>, emit = true) {
    const shape = {
      ...input,
      rotation: numeric(input.rotation),
      props: structuredClone(input.props),
    } as TShape
    this.shapes.set(shape.id, shape)
    void this.materialize(shape, emit)
    return this
  }

  createShapes(inputs: Array<ShapeInput<TLShape>>) {
    inputs.forEach(input => this.createShape(input, false))
    this.emitDocument()
    return this
  }

  updateShape<TShape extends TLShape = TLShape>(update: ShapeUpdate<TShape>) {
    const current = this.shapes.get(update.id)
    if (!current) return this
    const next = {
      ...current,
      ...update,
      props: update.props ? { ...current.props, ...update.props } : current.props,
    } as TLShape
    this.shapes.set(next.id, next)
    const object = this.objects.get(next.id)
    if (
      object
      && next.type === current.type
      && !(isImageShape(next) && (next.props.url !== (current as DesignImageShape).props.url))
      && !(isGeneratorShape(next) && (next.props.resultUrl !== (current as DesignGeneratorShape).props.resultUrl))
    ) {
      const { w, h } = shapeSize(next)
      if (object instanceof FabricImage) {
        const sourceWidth = Math.max(1, numeric(object.width, w))
        const sourceHeight = Math.max(1, numeric(object.height, h))
        object.set({
          left: next.x,
          top: next.y,
          width: sourceWidth,
          height: sourceHeight,
          scaleX: w / sourceWidth,
          scaleY: h / sourceHeight,
          angle: numeric(next.rotation) * 180 / Math.PI,
        })
      } else {
        object.set({
          left: next.x,
          top: next.y,
          width: w,
          height: h,
          scaleX: 1,
          scaleY: 1,
          angle: numeric(next.rotation) * 180 / Math.PI,
        })
      }
      object.setCoords()
      if (isMarkerShape(next) || isPlaceholderShape(next)) void this.materialize(next)
      else {
        this.canvas.requestRenderAll()
        this.emitDocument()
      }
    } else {
      void this.materialize(next)
    }
    return this
  }

  updateShapes(updates: Array<ShapeUpdate<TLShape>>) {
    this.suppressDocumentEvents++
    updates.forEach(update => this.updateShape(update))
    this.suppressDocumentEvents--
    this.canvas.requestRenderAll()
    this.emitDocument()
    return this
  }

  deleteShape(id: TLShapeId) {
    this.pendingSelectionIds = this.pendingSelectionIds.filter(item => item !== id)
    const object = this.objects.get(id)
    if (object) this.canvas.remove(object)
    this.objects.delete(id)
    this.shapes.delete(id)
    this.emitDocument()
    return this
  }

  deleteShapes(ids: TLShapeId[]) {
    this.suppressDocumentEvents++
    ids.forEach(id => this.deleteShape(id))
    this.suppressDocumentEvents--
    this.emitDocument()
    return this
  }

  getShape(id: TLShapeId) {
    const shape = this.shapes.get(id)
    return shape ? cloneShape(shape) : undefined
  }

  getCurrentPageShapes() {
    return Array.from(this.shapes.values(), cloneShape)
  }

  getCurrentPageShapeIds() {
    return new Set(this.shapes.keys())
  }

  getSelectedShapeIds() {
    const active = this.canvas.getActiveObjects()
    return active.flatMap(object => {
      const id = String(((object as FabricObject & { data?: { shapeId?: string } }).data)?.shapeId || '')
      return id && this.shapes.has(id) ? [id] : []
    })
  }

  getSelectedShapes() {
    return this.getSelectedShapeIds().flatMap(id => {
      const shape = this.shapes.get(id)
      return shape ? [cloneShape(shape)] : []
    })
  }

  select(...ids: TLShapeId[]) {
    const objects = ids.flatMap(id => {
      const object = this.objects.get(id)
      return object && object.selectable !== false ? [object] : []
    })
    if (objects.length !== ids.length) this.pendingSelectionIds = [...ids]
    else this.pendingSelectionIds = []
    this.canvas.discardActiveObject()
    if (objects.length === 1) this.canvas.setActiveObject(objects[0])
    else if (objects.length > 1) this.canvas.setActiveObject(new ActiveSelection(objects, { canvas: this.canvas }))
    this.canvas.requestRenderAll()
    this.emitUi()
    return this
  }

  selectNone() {
    this.pendingSelectionIds = []
    this.canvas.discardActiveObject()
    this.canvas.requestRenderAll()
    this.emitUi()
    return this
  }

  getShapePageBounds(shapeOrId: TLShape | TLShapeId): Bounds | null {
    const id = typeof shapeOrId === 'string' ? shapeOrId : shapeOrId.id
    const object = this.objects.get(id)
    if (object) {
      const rect = object.getBoundingRect()
      return {
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: rect.height,
        minX: rect.left,
        minY: rect.top,
        maxX: rect.left + rect.width,
        maxY: rect.top + rect.height,
        center: new Point(rect.left + rect.width / 2, rect.top + rect.height / 2),
      }
    }
    const shape = this.shapes.get(id)
    if (!shape) return null
    const size = shapeSize(shape)
    return {
      x: shape.x,
      y: shape.y,
      w: size.w,
      h: size.h,
      minX: shape.x,
      minY: shape.y,
      maxX: shape.x + size.w,
      maxY: shape.y + size.h,
      center: new Point(shape.x + size.w / 2, shape.y + size.h / 2),
    }
  }

  getShapePageTransform(shape: TLShape) {
    const angle = numeric(shape.rotation)
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    const transform = (inverse = false) => ({
      clone: () => transform(inverse),
      invert: () => transform(!inverse),
      applyToPoint: (point: PointLike) => inverse
        ? ({
            x: (point.x - shape.x) * cosine + (point.y - shape.y) * sine,
            y: -(point.x - shape.x) * sine + (point.y - shape.y) * cosine,
          })
        : ({
            x: shape.x + point.x * cosine - point.y * sine,
            y: shape.y + point.x * sine + point.y * cosine,
          }),
    })
    return transform()
  }

  getShapesAtPoint(point: PointLike, _options?: { hitInside?: boolean }) {
    return this.getCurrentPageShapes()
      .filter(shape => {
        if (shape.type === 'design-marker') return false
        const bounds = this.getShapePageBounds(shape)
        return Boolean(bounds && point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      })
      .reverse()
  }

  getViewportScreenBounds() {
    const rect = this.canvas.getElement().getBoundingClientRect()
    return { x: 0, y: 0, w: rect.width, h: rect.height, minX: 0, minY: 0, maxX: rect.width, maxY: rect.height }
  }

  getViewportPageBounds(): Bounds {
    const viewport = this.getViewportScreenBounds()
    const topLeft = this.viewportToPage({ x: 0, y: 0 })
    const bottomRight = this.viewportToPage({ x: viewport.w, y: viewport.h })
    return {
      x: topLeft.x,
      y: topLeft.y,
      w: bottomRight.x - topLeft.x,
      h: bottomRight.y - topLeft.y,
      minX: topLeft.x,
      minY: topLeft.y,
      maxX: bottomRight.x,
      maxY: bottomRight.y,
      center: new Point((topLeft.x + bottomRight.x) / 2, (topLeft.y + bottomRight.y) / 2),
    }
  }

  pageToViewport(point: PointLike) {
    return {
      x: point.x * this.camera.z + this.camera.x * this.camera.z,
      y: point.y * this.camera.z + this.camera.y * this.camera.z,
    }
  }

  private viewportToPage(point: PointLike) {
    return {
      x: point.x / this.camera.z - this.camera.x,
      y: point.y / this.camera.z - this.camera.y,
    }
  }

  screenToPage(point: PointLike) {
    const rect = this.canvas.getElement().getBoundingClientRect()
    return this.viewportToPage({ x: point.x - rect.left, y: point.y - rect.top })
  }

  getZoomLevel() {
    return this.camera.z
  }

  getCamera() {
    return { ...this.camera }
  }

  setCamera(camera: Camera, _options?: unknown) {
    this.camera = {
      x: numeric(camera.x),
      y: numeric(camera.y),
      z: Math.min(4, Math.max(.08, numeric(camera.z, 1))),
    }
    this.applyViewport()
    return this
  }

  private applyViewport() {
    const z = this.camera.z
    this.canvas.setViewportTransform([z, 0, 0, z, this.camera.x * z, this.camera.y * z])
    this.canvas.requestRenderAll()
    this.emitUi()
  }

  private zoomAt(viewportPoint: PointLike, zoom: number) {
    const before = this.viewportToPage(viewportPoint)
    this.camera.z = zoom
    this.camera.x = viewportPoint.x / zoom - before.x
    this.camera.y = viewportPoint.y / zoom - before.y
    this.applyViewport()
  }

  zoomIn() {
    const viewport = this.getViewportScreenBounds()
    this.zoomAt({ x: viewport.w / 2, y: viewport.h / 2 }, Math.min(4, this.camera.z * 1.2))
  }

  zoomOut() {
    const viewport = this.getViewportScreenBounds()
    this.zoomAt({ x: viewport.w / 2, y: viewport.h / 2 }, Math.max(.08, this.camera.z / 1.2))
  }

  zoomToBounds(bounds: Bounds, options?: { inset?: number; animation?: unknown }) {
    const viewport = this.getViewportScreenBounds()
    const inset = numeric(options?.inset, 80)
    const availableWidth = Math.max(80, viewport.w - inset * 2)
    const availableHeight = Math.max(80, viewport.h - inset * 2)
    const zoom = Math.min(2, Math.max(.08, Math.min(availableWidth / Math.max(1, bounds.w), availableHeight / Math.max(1, bounds.h))))
    this.setCamera({
      x: viewport.w / (2 * zoom) - (bounds.minX + bounds.maxX) / 2,
      y: viewport.h / (2 * zoom) - (bounds.minY + bounds.maxY) / 2,
      z: zoom,
    })
  }

  zoomToFit(options?: { inset?: number; animation?: unknown }) {
    const bounds = this.boundsForIds(Array.from(this.shapes.keys()))
    if (bounds) this.zoomToBounds(bounds, options)
  }

  zoomToSelectionIfOffscreen(_duration?: number, options?: { inset?: number; animation?: unknown }) {
    const bounds = this.boundsForIds(this.getSelectedShapeIds())
    if (!bounds) return
    const viewport = this.getViewportPageBounds()
    const inside = bounds.minX >= viewport.minX && bounds.minY >= viewport.minY && bounds.maxX <= viewport.maxX && bounds.maxY <= viewport.maxY
    if (!inside) this.zoomToBounds(bounds, options)
  }

  private boundsForIds(ids: TLShapeId[]) {
    const bounds = ids.flatMap(id => {
      const item = this.getShapePageBounds(id)
      return item ? [item] : []
    })
    if (!bounds.length) return null
    const minX = Math.min(...bounds.map(item => item.minX))
    const minY = Math.min(...bounds.map(item => item.minY))
    const maxX = Math.max(...bounds.map(item => item.maxX))
    const maxY = Math.max(...bounds.map(item => item.maxY))
    return {
      x: minX,
      y: minY,
      w: maxX - minX,
      h: maxY - minY,
      minX,
      minY,
      maxX,
      maxY,
      center: new Point((minX + maxX) / 2, (minY + maxY) / 2),
    }
  }

  setCurrentTool(tool: string) {
    this.currentTool = tool
    this.canvas.isDrawingMode = tool === 'draw'
    this.canvas.selection = tool === 'select' && !this.spacePanActive && !this.pointerPanning
    this.canvas.skipTargetFind = this.pointerPanning || this.spacePanActive || tool === 'hand'
    this.updateCanvasCursor()
    if (tool === 'draw') {
      const brush = new PencilBrush(this.canvas)
      brush.color = '#111827'
      brush.width = 3
      this.canvas.freeDrawingBrush = brush
    }
    this.emitUi()
  }

  private updateCanvasCursor() {
    const cursor = this.pointerPanning
      ? 'grabbing'
      : this.spacePanActive || this.currentTool === 'hand'
        ? 'grab'
        : ['draw', 'text', 'geo'].includes(this.currentTool)
          ? 'crosshair'
          : 'default'
    this.canvas.defaultCursor = cursor
    this.canvas.hoverCursor = this.spacePanActive || this.currentTool === 'hand'
      ? cursor
      : this.currentTool === 'select' ? 'move' : cursor
    this.canvas.requestRenderAll()
  }

  setSpacePanActive(active: boolean) {
    if (this.spacePanActive === active) return this
    this.spacePanActive = active
    this.canvas.isDrawingMode = !active && this.currentTool === 'draw'
    this.canvas.skipTargetFind = this.pointerPanning || active || this.currentTool === 'hand'
    this.canvas.selection = !this.pointerPanning && !active && this.currentTool === 'select'
    this.updateCanvasCursor()
    return this
  }

  cancelTransientPan() {
    this.spacePanActive = false
    this.pointerPanning = false
    this.canvas.isDrawingMode = this.currentTool === 'draw'
    this.canvas.skipTargetFind = this.currentTool === 'hand'
    this.canvas.selection = this.currentTool === 'select'
    this.updateCanvasCursor()
    return this
  }

  getCurrentToolId() {
    return this.currentTool
  }

  updateInstanceState(_state: unknown) {
    return this
  }

  run(callback: () => void, options?: { history?: 'ignore'; ignoreShapeLock?: boolean }) {
    if (options?.history === 'ignore') this.suppressDocumentEvents++
    try {
      callback()
    } finally {
      if (options?.history === 'ignore') this.suppressDocumentEvents--
    }
    if (options?.history !== 'ignore') this.emitDocument()
  }

  alignShapes(ids: TLShapeId[], alignment: 'left' | 'right' | 'top' | 'bottom' | 'center-horizontal' | 'center-vertical') {
    const shapes = ids.flatMap(id => {
      const shape = this.shapes.get(id)
      return shape ? [shape] : []
    })
    if (shapes.length < 2) return
    const bounds = shapes.map(shape => this.getShapePageBounds(shape)).filter((item): item is Bounds => Boolean(item))
    const target = alignment === 'left' ? Math.min(...bounds.map(item => item.minX))
      : alignment === 'right' ? Math.max(...bounds.map(item => item.maxX))
        : alignment === 'top' ? Math.min(...bounds.map(item => item.minY))
          : alignment === 'bottom' ? Math.max(...bounds.map(item => item.maxY))
            : 0
    const updates = shapes.map(shape => {
      const item = this.getShapePageBounds(shape)!
      if (alignment === 'left') return { id: shape.id, x: target }
      if (alignment === 'right') return { id: shape.id, x: shape.x + target - item.maxX }
      if (alignment === 'top') return { id: shape.id, y: target }
      if (alignment === 'bottom') return { id: shape.id, y: shape.y + target - item.maxY }
      return { id: shape.id }
    })
    this.updateShapes(updates)
  }

  groupShapes(ids: TLShapeId[]) {
    const objects = ids.flatMap(id => {
      const object = this.objects.get(id)
      return object ? [object] : []
    })
    if (objects.length < 2) return
    this.canvas.setActiveObject(new ActiveSelection(objects, { canvas: this.canvas }))
    this.canvas.requestRenderAll()
    this.emitUi()
  }

  async toImage(ids: TLShapeId[], options: { format?: 'png'; background?: boolean; padding?: number; scale?: number }) {
    const bounds = this.boundsForIds(ids)
    if (!bounds) return { blob: new Blob([], { type: 'image/png' }) }
    const selected = new Set(ids)
    const visibility = new Map<FabricObject, boolean>()
    for (const [id, object] of this.objects) {
      visibility.set(object, object.visible)
      object.visible = selected.has(id)
    }
    this.canvas.discardActiveObject()
    this.canvas.requestRenderAll()
    const padding = numeric(options.padding)
    const multiplier = Math.max(.25, numeric(options.scale, 1))
    const previousViewport = [...this.canvas.viewportTransform] as [number, number, number, number, number, number]
    this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
    const element = this.canvas.toCanvasElement(multiplier, {
      left: bounds.minX - padding,
      top: bounds.minY - padding,
      width: bounds.w + padding * 2,
      height: bounds.h + padding * 2,
    })
    this.canvas.setViewportTransform(previousViewport)
    visibility.forEach((visible, object) => { object.visible = visible })
    this.canvas.requestRenderAll()
    const blob = await new Promise<Blob>((resolve, reject) => {
      element.toBlob(result => result ? resolve(result) : reject(new Error('画布导出失败')), 'image/png')
    })
    return { blob }
  }

  snapshot(): FabricSnapshot {
    return {
      version: 2,
      objects: this.getCurrentPageShapes(),
      viewport: this.getCamera(),
      fabric_json: this.canvas.toObject(['data']) as Record<string, unknown>,
    }
  }

  sessionSnapshot() {
    return {
      camera: this.getCamera(),
      selected_shape_ids: this.getSelectedShapeIds(),
      current_tool: this.getCurrentToolId(),
    }
  }

  async load(snapshot: unknown, session?: unknown) {
    const next = isFabricSnapshot(snapshot) ? snapshot : convertTldrawSnapshot(snapshot)
    this.suppressDocumentEvents++
    this.canvas.discardActiveObject()
    this.canvas.clear()
    this.shapes.clear()
    this.objects.clear()
    for (const shape of next.objects) {
      const cloned = cloneShape(shape)
      this.shapes.set(cloned.id, cloned)
      await this.materialize(cloned, false)
    }
    const savedSession = session && typeof session === 'object' ? session as Record<string, unknown> : {}
    const savedCamera = savedSession.camera && typeof savedSession.camera === 'object'
      ? savedSession.camera as Camera
      : next.viewport
    this.camera = {
      x: numeric(savedCamera?.x),
      y: numeric(savedCamera?.y),
      z: Math.max(.08, numeric(savedCamera?.z, 1)),
    }
    this.applyViewport()
    const selectedIds = Array.isArray(savedSession.selected_shape_ids)
      ? savedSession.selected_shape_ids.filter((id): id is string => typeof id === 'string')
      : []
    this.select(...selectedIds)
    this.currentTool = typeof savedSession.current_tool === 'string' ? savedSession.current_tool : 'select'
    this.suppressDocumentEvents--
    this.history = []
    this.historyIndex = -1
    this.pushHistory()
    this.emitUi()
  }

  undo() {
    if (this.historyTimer) {
      window.clearTimeout(this.historyTimer)
      this.historyTimer = 0
      this.pushHistory()
    }
    if (this.historyIndex <= 0) return
    this.historyIndex--
    void this.loadHistory(this.history[this.historyIndex])
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return
    this.historyIndex++
    void this.loadHistory(this.history[this.historyIndex])
  }

  private async loadHistory(snapshot: FabricSnapshot) {
    const preservedHistory = this.history
    const preservedIndex = this.historyIndex
    await this.load(snapshot)
    this.history = preservedHistory
    this.historyIndex = preservedIndex
    this.emitDocument()
  }
}

function isFabricSnapshot(value: unknown): value is FabricSnapshot {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (record.version === 1 || record.version === 2) && Array.isArray(record.objects)
}

export function getSnapshot(store: FabricEditor['store']) {
  return {
    document: store.editor.snapshot(),
    session: store.editor.sessionSnapshot(),
  }
}

export function loadSnapshot(store: FabricEditor['store'], envelope: SnapshotEnvelope) {
  return store.editor.load(envelope.document, envelope.session)
}

export type Editor = FabricEditor

function GeneratorOverlay({ editor, shape }: { editor: FabricEditor; shape: DesignGeneratorShape }) {
  const size = shapeSize(shape)
  const camera = editor.getCamera()
  const point = editor.pageToViewport({ x: shape.x, y: shape.y })
  const dragRef = useRef<{ x: number; y: number; shapeX: number; shapeY: number } | null>(null)
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button,textarea,input,select,[role=listbox]')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    editor.select(shape.id)
    dragRef.current = { x: event.clientX, y: event.clientY, shapeX: shape.x, shapeY: shape.y }
  }
  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    editor.updateShape({
      id: shape.id,
      x: dragRef.current.shapeX + (event.clientX - dragRef.current.x) / camera.z,
      y: dragRef.current.shapeY + (event.clientY - dragRef.current.y) / camera.z,
    })
  }
  const stopDrag = () => { dragRef.current = null }
  return (
    <div
      className="fabric-generator-overlay"
      style={{
        left: point.x,
        top: point.y,
        width: size.w,
        height: size.h,
        transform: `scale(${camera.z}) rotate(${numeric(shape.rotation)}rad)`,
        transformOrigin: 'top left',
      }}
      onPointerDown={startDrag}
      onPointerMove={drag}
      onPointerUp={stopDrag}
      onPointerCancel={stopDrag}
    >
      <DesignGeneratorCard
        shape={shape}
        onUpdate={props => editor.updateShape<DesignGeneratorShape>({ id: shape.id, props })}
      />
    </div>
  )
}

export function FabricCanvas({
  onMount,
}: {
  onMount: (editor: FabricEditor) => void
}) {
  const shellRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const editorRef = useRef<FabricEditor | null>(null)
  const onMountRef = useRef(onMount)
  const [revision, setRevision] = useState(0)
  onMountRef.current = onMount

  useEffect(() => {
    if (!shellRef.current || !canvasRef.current) return
    const shell = shellRef.current
    const fabric = new Canvas(canvasRef.current, {
      width: Math.max(1, shell.clientWidth),
      height: Math.max(1, shell.clientHeight),
      selection: true,
      preserveObjectStacking: true,
      backgroundColor: '#f7f7f8',
      fireRightClick: true,
      stopContextMenu: true,
    })
    const editor = new FabricEditor(fabric)
    editorRef.current = editor
    let shapeClipboard: TLShape[] = []
    let pasteCount = 0
    const dispose = editor.store.listen(() => setRevision(value => value + 1))
    const observer = new ResizeObserver(() => {
      fabric.setDimensions({ width: Math.max(1, shell.clientWidth), height: Math.max(1, shell.clientHeight) })
      fabric.requestRenderAll()
      setRevision(value => value + 1)
    })
    const onKeyDown = (event: KeyboardEvent) => {
      if (isFabricTextEntryTarget(event.target)) return
      if (isUndoKeyboardEvent(event)) {
        event.preventDefault()
        editor.undo()
        return
      }
      if (isRedoKeyboardEvent(event)) {
        event.preventDefault()
        editor.redo()
        return
      }
      if (isSpacePanKeyboardEvent(event)) {
        event.preventDefault()
        editor.setSpacePanActive(true)
        return
      }
      if (event.key === 'Escape') {
        editor.selectNone()
        editor.setCurrentTool('select')
        return
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const ids = editor.getSelectedShapeIds()
      if (!ids.length) return
      event.preventDefault()
      editor.deleteShapes(ids)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!isSpacePanKeyboardEvent(event)) return
      editor.setSpacePanActive(false)
    }
    const onCopy = (event: ClipboardEvent) => {
      if (isFabricTextEntryTarget(event.target)) return
      const selected = editor.getSelectedShapes()
      if (!selected.length || !event.clipboardData) return
      event.preventDefault()
      event.stopPropagation()
      shapeClipboard = selected.map(cloneShape)
      pasteCount = 0
      event.clipboardData.setData(FABRIC_CLIPBOARD_MIME, JSON.stringify(shapeClipboard))
      event.clipboardData.setData('text/plain', FABRIC_CLIPBOARD_TEXT)
    }
    const onPaste = (event: ClipboardEvent) => {
      if (isFabricTextEntryTarget(event.target)) return
      const encoded = event.clipboardData?.getData(FABRIC_CLIPBOARD_MIME) || ''
      const text = event.clipboardData?.getData('text/plain') || ''
      const source = parseFabricClipboardShapes(encoded)
      const shapes = source.length ? source : text === FABRIC_CLIPBOARD_TEXT ? shapeClipboard : []
      if (!shapes.length) return
      event.preventDefault()
      event.stopPropagation()
      pasteCount++
      const copies = cloneFabricClipboardShapes(shapes, 24 * pasteCount)
      editor.createShapes(copies)
      editor.select(...copies.map(shape => shape.id))
    }
    const onWindowBlur = () => {
      shapeClipboard = []
      pasteCount = 0
      editor.cancelTransientPan()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('copy', onCopy)
    window.addEventListener('paste', onPaste)
    window.addEventListener('blur', onWindowBlur)
    observer.observe(shell)
    onMountRef.current(editor)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('copy', onCopy)
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('blur', onWindowBlur)
      observer.disconnect()
      dispose()
      editorRef.current = null
      editor.dispose()
    }
  }, [])

  const generators = useMemo(
    () => editorRef.current?.getCurrentPageShapes().filter(isGeneratorShape) || [],
    [revision],
  )

  return (
    <div ref={shellRef} className="fabric-canvas-shell" data-testid="fabric-canvas">
      <canvas ref={canvasRef} />
      <div className="fabric-html-overlay">
        {editorRef.current && generators.map(shape => <GeneratorOverlay key={shape.id} editor={editorRef.current!} shape={shape} />)}
      </div>
    </div>
  )
}
