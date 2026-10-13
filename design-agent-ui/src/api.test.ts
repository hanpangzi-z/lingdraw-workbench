import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api } from './api'

describe('api errors', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves the structured generation outcome and conversation identity', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      detail: {
        code: 'generation_outcome_unknown',
        message: '上游返回前连接中断。',
        conversation_id: 'conversation-1',
        request_id: 'request-1',
        operation_id: 'request-1:image:1',
        upstream_outcome: 'unknown',
        retryable: false,
      },
    }), { status: 502, headers: { 'Content-Type': 'application/json' } }))))

    const error = await api('/api/chat/agent').catch(value => value)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 502,
      code: 'generation_outcome_unknown',
      conversationId: 'conversation-1',
      requestId: 'request-1',
      operationId: 'request-1:image:1',
      upstreamOutcome: 'unknown',
      retryable: false,
      message: '上游返回前连接中断。',
    })
  })

  it('surfaces the sanitized upstream diagnostic identity', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      detail: {
        code: 'upstream_rate_limited',
        message: 'Upstream rate limited.',
        diagnostic_id: 'upstream-0123456789abcdef',
        upstream_status: 429,
        retryable: true,
      },
    }), { status: 429, headers: { 'Content-Type': 'application/json' } }))))

    const error = await api('/api/agent/workbench/plan').catch(value => value)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 429,
      code: 'upstream_rate_limited',
      diagnosticId: 'upstream-0123456789abcdef',
      upstreamStatus: 429,
      retryable: true,
      message: 'Upstream rate limited.（诊断编号：upstream-0123456789abcdef）',
    })
  })

  it('reads the exact refunded points from a failed metered response', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({
      detail: '上游生成失败',
    }), {
      status: 502,
      headers: {'Content-Type': 'application/json', 'X-Refunded-Points': '4'},
    }))))

    const error = await api('/api/chat/agent').catch(value => value)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({status: 502, refundedPoints: 4})
  })
})
