export type JsonObject = Record<string, unknown>

export type ApiErrorDetail = JsonObject & {
  code?: string
  message?: string
  conversation_id?: string
  request_id?: string
  operation_id?: string
  upstream_outcome?: string
  diagnostic_id?: string
  upstream_status?: number
  retryable?: boolean
  refunded_points?: number
}

export class ApiError extends Error {
  readonly status: number
  readonly detail: ApiErrorDetail | string | unknown
  readonly payload: JsonObject
  readonly code: string
  readonly conversationId: string
  readonly requestId: string
  readonly operationId: string
  readonly upstreamOutcome: string
  readonly diagnosticId: string
  readonly upstreamStatus?: number
  readonly retryable?: boolean
  readonly refundedPoints: number

  constructor(status: number, payload: JsonObject) {
    const rawDetail = payload.detail
    const detailObject = rawDetail && typeof rawDetail === 'object' && !Array.isArray(rawDetail)
      ? rawDetail as ApiErrorDetail
      : null
    const detail = detailObject || rawDetail
    const baseMessage = typeof rawDetail === 'string'
      ? rawDetail
      : detailObject?.message || String(payload.message || `HTTP ${status}`)
    const diagnosticId = String(detailObject?.diagnostic_id || '')
    const message = diagnosticId && !baseMessage.includes(diagnosticId)
      ? `${baseMessage}（诊断编号：${diagnosticId}）`
      : baseMessage
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.payload = payload
    this.code = String(detailObject?.code || '')
    this.conversationId = String(detailObject?.conversation_id || '')
    this.requestId = String(detailObject?.request_id || '')
    this.operationId = String(detailObject?.operation_id || '')
    this.upstreamOutcome = String(detailObject?.upstream_outcome || '')
    this.diagnosticId = diagnosticId
    this.upstreamStatus = typeof detailObject?.upstream_status === 'number'
      ? detailObject.upstream_status
      : undefined
    this.retryable = typeof detailObject?.retryable === 'boolean'
      ? detailObject.retryable
      : undefined
    this.refundedPoints = Number(payload.refunded_points || detailObject?.refunded_points || 0)
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({})) as JsonObject
  const refundedPoints = Number(response.headers.get('X-Refunded-Points') || 0)
  if (refundedPoints > 0) payload.refunded_points = refundedPoints
  if (!response.ok) {
    throw new ApiError(response.status, payload)
  }
  return payload as T
}
