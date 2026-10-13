export type Project = { id: string; name: string; updated_at: number }
export type CanvasSummary = {
  id: string
  title: string
  kind: 'classic' | 'smart'
  updated_at: number
  surfaces?: string[]
}
export type VersionedDocument = { version: number; payload: Record<string, unknown> }
export type Run = {
  id: string
  project_id: string
  status: 'draft' | 'planning' | 'awaiting_approval' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled'
  current_approval_kind: '' | 'plan' | 'first_result' | 'publish'
  plan_json: { objective?: string; steps?: Array<Record<string, unknown>> }
  totals_json: { points?: number; assets?: number }
  error?: string
}
export type Step = {
  id: string
  role: string
  title: string
  status: string
  attempt_count: number
  error?: string
}
export type Approval = {
  id: string
  kind: 'plan' | 'first_result' | 'publish'
  status: 'pending' | 'approved' | 'rejected'
  reason?: string
}
export type Asset = {
  id: string
  parent_asset_id?: string
  version: number
  name: string
  url: string
  model?: string
}
export type QualityReport = {
  id: string
  passed: boolean
  report_json: { overall_score?: number; hard_issues?: string[]; scores?: Record<string, number>; summary?: string }
}
export type RunSnapshot = { run: Run; steps: Step[]; approvals: Approval[]; assets: Asset[]; quality_reports: QualityReport[] }
export type ProjectBundle = {
  project: Project
  brief: VersionedDocument | null
  brand_kit: VersionedDocument | null
  runs: Run[]
}
export type Skill = { id: string; slug: string; name: string; version: number; status: string }
