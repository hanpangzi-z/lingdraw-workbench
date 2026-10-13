import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  decideCanvasDocumentRestore,
  discardCanvasDocumentDraft,
  readCanvasDocumentDraft,
  rebaseOrClearCanvasDocumentDraft,
  saveCanvasDocumentDraft,
} from './canvasDocumentDraft'

type Document = { snapshot: { page: string }; updated_at?: number }
const CLIENT = 'tab-a'

describe('local canvas document drafts', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('stores the document and its server base independently for each canvas', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234)
    const first = { snapshot: { page: 'first' } }
    const second = { snapshot: { page: 'second' } }

    saveCanvasDocumentDraft('canvas-1', CLIENT, 10, first)
    saveCanvasDocumentDraft('canvas-2', CLIENT, 20, second)

    expect(readCanvasDocumentDraft<Document>('canvas-1', CLIENT)).toEqual({
      client_id: CLIENT,
      base_updated_at: 10,
      saved_at: 1234,
      document: first,
    })
    expect(readCanvasDocumentDraft<Document>('canvas-2', CLIENT)?.document).toEqual(second)
  })

  it('discards only the requested canvas draft', () => {
    saveCanvasDocumentDraft('canvas-1', CLIENT, 10, { snapshot: { page: 'first' } })
    saveCanvasDocumentDraft('canvas-2', CLIENT, 20, { snapshot: { page: 'second' } })

    discardCanvasDocumentDraft('canvas-1', CLIENT)

    expect(readCanvasDocumentDraft('canvas-1', CLIENT)).toBeNull()
    expect(readCanvasDocumentDraft('canvas-2', CLIENT)).not.toBeNull()
  })

  it('restores the local document when its server base still matches', () => {
    const server = { snapshot: { page: 'server' } }
    const local = { snapshot: { page: 'local' } }
    saveCanvasDocumentDraft('canvas-1', CLIENT, 10, local)
    const draft = readCanvasDocumentDraft<Document>('canvas-1', CLIENT)

    expect(decideCanvasDocumentRestore(10, server, draft)).toEqual({
      status: 'local',
      document: local,
      draft,
    })
  })

  it('uses the server document when there is no local draft', () => {
    const server = { snapshot: { page: 'server' } }

    expect(decideCanvasDocumentRestore(10, server, null)).toEqual({
      status: 'server',
      document: server,
      draft: null,
    })
  })

  it('reports both versions as a conflict when the server base differs', () => {
    const server = { snapshot: { page: 'server' }, updated_at: 1 }
    const local = { snapshot: { page: 'local' }, updated_at: 999999 }
    saveCanvasDocumentDraft('canvas-1', CLIENT, 10, local)
    const draft = readCanvasDocumentDraft<Document>('canvas-1', CLIENT)

    expect(decideCanvasDocumentRestore(11, server, draft)).toEqual({
      status: 'conflict',
      server_document: server,
      local_document: local,
      draft,
    })
  })

  it('accepts an identical newer server document after a save response is lost', () => {
    const document = { snapshot: { page: 'already-saved' } }
    saveCanvasDocumentDraft('canvas-1', CLIENT, 10, document)
    const draft = readCanvasDocumentDraft<Document>('canvas-1', CLIENT)

    expect(decideCanvasDocumentRestore(11, document, draft)).toEqual({
      status: 'server',
      document,
      draft: null,
    })
  })

  it('rebases a newer local document when an older queued save completes', () => {
    const saved = { snapshot: { page: 'saved' } }
    const newer = { snapshot: { page: 'newer' } }
    saveCanvasDocumentDraft('canvas-1', CLIENT, 10, newer)

    rebaseOrClearCanvasDocumentDraft('canvas-1', CLIENT, saved, 11)

    expect(readCanvasDocumentDraft<Document>('canvas-1', CLIENT)).toMatchObject({
      base_updated_at: 11,
      document: newer,
    })
  })

  it('clears a local document after that exact revision reaches the server', () => {
    const saved = { snapshot: { page: 'saved' } }
    saveCanvasDocumentDraft('canvas-1', CLIENT, 10, saved)

    rebaseOrClearCanvasDocumentDraft('canvas-1', CLIENT, saved, 11)

    expect(readCanvasDocumentDraft('canvas-1', CLIENT)).toBeNull()
  })

  it('never clears another tab draft for the same canvas', () => {
    const first = { snapshot: { page: 'tab-a' } }
    const second = { snapshot: { page: 'tab-b' } }
    vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(200)
    saveCanvasDocumentDraft('canvas-1', 'tab-a', 10, first)
    saveCanvasDocumentDraft('canvas-1', 'tab-b', 10, second)

    rebaseOrClearCanvasDocumentDraft('canvas-1', 'tab-a', first, 11)

    expect(localStorage.length).toBe(1)
    expect(readCanvasDocumentDraft<Document>('canvas-1', 'new-tab')?.document).toEqual(second)
  })
})
