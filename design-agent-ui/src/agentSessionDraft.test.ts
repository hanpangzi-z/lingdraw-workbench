import { beforeEach, describe, expect, it } from 'vitest'
import {
  readAgentSessionDraft,
  rebaseOrClearAgentSessionDraft,
  restoreAgentSessionDraft,
  saveAgentSessionDraft,
} from './agentSessionDraft'

type Session = { conversation_id: string; messages: string[]; run: null; updated_at: number }
const CLIENT = 'tab-a'

describe('offline Agent session drafts', () => {
  beforeEach(() => localStorage.clear())

  it('restores a draft directly while its server base version is still current', () => {
    const server = { conversation_id: 'server', messages: [], run: null, updated_at: 100 }
    const local = { conversation_id: 'local', messages: ['unsaved'], run: null, updated_at: 110 }
    saveAgentSessionDraft('canvas-1', CLIENT, 12, local)
    const draft = readAgentSessionDraft<Session>('canvas-1', CLIENT)

    expect(restoreAgentSessionDraft(12, server, draft)).toEqual({
      session: local,
      restored: true,
      stale: false,
      rebased: false,
    })
  })

  it('does not use the browser clock to overwrite a newer server revision', () => {
    const server = { conversation_id: 'server', messages: ['saved'], run: null, updated_at: 100 }
    const local = { conversation_id: 'local', messages: ['saved', 'unsaved'], run: null, updated_at: 120 }
    saveAgentSessionDraft('canvas-1', CLIENT, 12, local)

    expect(restoreAgentSessionDraft(13, server, readAgentSessionDraft<Session>('canvas-1', CLIENT))).toEqual({
      session: server,
      restored: false,
      stale: true,
      rebased: false,
    })
  })

  it('keeps the server session when a stale draft is not newer', () => {
    const server = { conversation_id: 'server', messages: ['latest'], run: null, updated_at: 130 }
    const local = { conversation_id: 'local', messages: ['older'], run: null, updated_at: 120 }
    saveAgentSessionDraft('canvas-1', CLIENT, 12, local)

    expect(restoreAgentSessionDraft(13, server, readAgentSessionDraft<Session>('canvas-1', CLIENT))).toEqual({
      session: server,
      restored: false,
      stale: true,
      rebased: false,
    })
  })

  it('rebases a newer local draft instead of deleting it when an older save completes', () => {
    const saved = { conversation_id: 'chat', messages: ['one'], run: null, updated_at: 100 }
    const newer = { conversation_id: 'chat', messages: ['one', 'two'], run: null, updated_at: 110 }
    saveAgentSessionDraft('canvas-1', CLIENT, 12, newer)

    rebaseOrClearAgentSessionDraft('canvas-1', CLIENT, saved, 13)

    expect(readAgentSessionDraft<Session>('canvas-1', CLIENT)).toMatchObject({
      base_updated_at: 13,
      agent_session: newer,
    })
  })

  it('clears the draft after the same Agent session is saved', () => {
    const session = { conversation_id: 'chat', messages: ['saved'], run: null, updated_at: 100 }
    saveAgentSessionDraft('canvas-1', CLIENT, 12, session)

    rebaseOrClearAgentSessionDraft('canvas-1', CLIENT, session, 13)

    expect(readAgentSessionDraft<Session>('canvas-1', CLIENT)).toBeNull()
  })
})
