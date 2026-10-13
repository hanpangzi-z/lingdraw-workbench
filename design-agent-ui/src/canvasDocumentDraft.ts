export type CanvasDocumentDraft<T> = {
  client_id: string
  base_updated_at: number
  saved_at: number
  document: T
}

export type CanvasDocumentRestoreDecision<T> =
  | { status: 'server'; document: T; draft: null }
  | { status: 'local'; document: T; draft: CanvasDocumentDraft<T> }
  | {
      status: 'conflict'
      server_document: T
      local_document: T
      draft: CanvasDocumentDraft<T>
    }

const prefixFor = (canvasId: string) => `design-agent-canvas-document-draft-${canvasId}-`
const keyFor = (canvasId: string, clientId: string) => `${prefixFor(canvasId)}${clientId}`

function validDraft<T>(value: unknown): value is CanvasDocumentDraft<T> {
  if (!value || typeof value !== 'object') return false
  const draft = value as CanvasDocumentDraft<T>
  return Boolean(
    draft.client_id
    && Number.isFinite(draft.base_updated_at)
    && Number.isFinite(draft.saved_at)
    && Object.prototype.hasOwnProperty.call(draft, 'document'),
  )
}

export function saveCanvasDocumentDraft<T>(canvasId: string, clientId: string, baseUpdatedAt: number, document: T) {
  if (!canvasId || !clientId) return
  try {
    localStorage.setItem(keyFor(canvasId, clientId), JSON.stringify({
      client_id: clientId,
      base_updated_at: baseUpdatedAt,
      saved_at: Date.now(),
      document,
    } satisfies CanvasDocumentDraft<T>))
  } catch {
    // The server document remains authoritative when browser storage is unavailable.
  }
}

export function readCanvasDocumentDraft<T>(canvasId: string, clientId: string): CanvasDocumentDraft<T> | null {
  if (!canvasId || !clientId) return null
  try {
    const prefix = prefixFor(canvasId)
    const candidates: CanvasDocumentDraft<T>[] = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith(prefix)) continue
      try {
        const draft = JSON.parse(localStorage.getItem(key) || 'null') as unknown
        if (validDraft<T>(draft)) candidates.push(draft)
      } catch {
        // Keep scanning recoverable drafts from other tabs.
      }
    }
    candidates.sort((left, right) => right.saved_at - left.saved_at)
    return candidates[0] || null
  } catch {
    return null
  }
}

function readOwnedCanvasDocumentDraft<T>(canvasId: string, clientId: string): CanvasDocumentDraft<T> | null {
  try {
    const draft = JSON.parse(localStorage.getItem(keyFor(canvasId, clientId)) || 'null') as unknown
    return validDraft<T>(draft) && draft.client_id === clientId ? draft : null
  } catch {
    return null
  }
}

function discardMatchingCanvasDocumentDrafts<T>(canvasId: string, document: T) {
  const prefix = prefixFor(canvasId)
  const target = JSON.stringify(document)
  const removals: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key?.startsWith(prefix)) continue
    try {
      const draft = JSON.parse(localStorage.getItem(key) || 'null') as unknown
      if (validDraft<T>(draft) && JSON.stringify(draft.document) === target) removals.push(key)
    } catch {
      // Ignore malformed records while scanning other tab drafts.
    }
  }
  removals.forEach(key => localStorage.removeItem(key))
}

export function discardCanvasDocumentDraft(canvasId: string, clientId: string) {
  if (!canvasId || !clientId) return
  try {
    localStorage.removeItem(keyFor(canvasId, clientId))
  } catch {
    // Ignore unavailable browser storage.
  }
}

export function rebaseOrClearCanvasDocumentDraft<T>(
  canvasId: string,
  clientId: string,
  savedDocument: T,
  updatedAt: number,
) {
  const draft = readOwnedCanvasDocumentDraft<T>(canvasId, clientId)
  if (!draft) return
  if (JSON.stringify(draft.document) === JSON.stringify(savedDocument)) {
    discardMatchingCanvasDocumentDrafts(canvasId, savedDocument)
    return
  }
  saveCanvasDocumentDraft(canvasId, clientId, updatedAt, draft.document)
}

export function decideCanvasDocumentRestore<T>(
  serverUpdatedAt: number,
  serverDocument: T,
  draft: CanvasDocumentDraft<T> | null,
): CanvasDocumentRestoreDecision<T> {
  if (!draft) return { status: 'server', document: serverDocument, draft: null }
  // A PUT may have committed even when its response was lost. In that case the
  // newer server revision already contains the exact local draft and is safe to
  // accept without showing a false conflict.
  if (JSON.stringify(draft.document) === JSON.stringify(serverDocument)) {
    return { status: 'server', document: serverDocument, draft: null }
  }
  if (draft.base_updated_at === serverUpdatedAt) {
    return { status: 'local', document: draft.document, draft }
  }
  return {
    status: 'conflict',
    server_document: serverDocument,
    local_document: draft.document,
    draft,
  }
}
