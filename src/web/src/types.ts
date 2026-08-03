/**
 * Mirrors the backend contract: `StructuredReport` in src/llm-client.ts and the
 * row shapes returned by `getRaw` / `getProcessed` in src/db.ts.
 */

export type Sentiment = 'negative' | 'neutral' | 'positive'

export type ComplaintStatus = 'pending' | 'matched' | 'new_report_created'

export interface StructuredReport {
  title: string
  category: string
  sentiment: Sentiment
  description: string
}

export interface RawComplaint {
  id: string
  raw_text: string
  received_at: string
  processed_report_id: string | null
  status: ComplaintStatus
}

export interface ProcessedReport {
  id: string
  structured_report: StructuredReport
  canonical_summary: string
  created_at: string
  match_count: number
}

/** One step of the pipeline, surfaced so the UI can narrate what happened. */
export type TraceStage =
  | 'ingest'
  | 'embed'
  | 'search'
  | 'match'
  | 'structure'
  | 'persist'

export type TraceState = 'pending' | 'running' | 'done' | 'skipped'

export interface TraceStep {
  stage: TraceStage
  state: TraceState
  label: string
  detail?: string
}

export type PipelineOutcome = 'matched' | 'new_report_created'

export interface PipelineResult {
  outcome: PipelineOutcome
  complaintId: string
  reportId: string
  /** Cosine similarity to the nearest report; null when no reports existed yet. */
  similarity: number | null
}
