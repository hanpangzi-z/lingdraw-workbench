export type AgentSessionDraft<T> = {
  client_id: string
  base_updated_at: number
  saved_at: number
  agent_session: T
}

export type AgentSessionRestoreResult<T> = {
  session: T | undefined
  restored: boolean
  stale: boolean
  rebased: boolean
}

const keyFor = (canvasId: string, clientId: string) => `design-agent-session-draft-${canvasId}-${clientId}`

export function readAgentSessionDraft<T>(canvasId: string, clientId: string): AgentSessionDraft<T> | null {
  if (!canvasId || !clientId) return null
  try {
    const value = JSON.parse(localStorage.getItem(keyFor(canvasId, clientId)) || 'null') as AgentSessionDraft<T> | null
    if (!value || value.client_id !== clientId || typeof value.base_updated_at !== 'number' || !value.agent_session) return null
    return value
  } catch {
    return null
  }
}

export function saveAgentSessionDraft<T>(canvasId: string, clientId: string, baseUpdatedAt: number, agentSession: T) {
  if (!canvasId || !clientId) return
  try {
    localStorage.setItem(keyFor(canvasId, clientId), JSON.stringify({
      client_id: clientId,
      base_updated_at: baseUpdatedAt,
      saved_at: Date.now(),
      agent_session: agentSession,
    } satisfies AgentSessionDraft<T>))
  } catch {
    // The server snapshot remains the source of truth when browser storage is unavailable.
  }
}

export function discardAgentSessionDraft(canvasId: string, clientId: string) {
  if (canvasId && clientId) localStorage.removeItem(keyFor(canvasId, clientId))
}

export function restoreAgentSessionDraft<T>(
  serverUpdatedAt: number,
  serverSession: T | undefined,
  draft: AgentSessionDraft<T> | null,
): AgentSessionRestoreResult<T> {
  if (draft?.base_updated_at === serverUpdatedAt) {
    return { session: draft.agent_session, restored: true, stale: false, rebased: false }
  }
  if (!draft) {
    return { session: serverSession, restored: false, stale: false, rebased: false }
  }
  return { session: serverSession, restored: false, stale: true, rebased: false }
}

export function rebaseOrClearAgentSessionDraft<T>(
  canvasId: string,
  clientId: string,
  savedSession: T | undefined,
  updatedAt: number,
) {
  const draft = readAgentSessionDraft<T>(canvasId, clientId)
  if (!draft) return
  if (JSON.stringify(draft.agent_session) === JSON.stringify(savedSession)) {
    discardAgentSessionDraft(canvasId, clientId)
    return
  }
  saveAgentSessionDraft(canvasId, clientId, updatedAt, draft.agent_session)
}
