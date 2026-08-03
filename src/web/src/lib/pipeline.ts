/**
 * Client-side re-implementation of src/pipeline.ts.
 *
 * Same control flow as the server: insert the raw complaint, embed it, find the
 * nearest processed report, then either link to it (Case B) or structure it into
 * a new report (Case A). The difference is that embedding and structuring are
 * local stand-ins and each step reports progress so the UI can narrate it.
 */

import type {
  PipelineResult,
  ProcessedReport,
  RawComplaint,
  TraceStage,
  TraceStep,
} from '../types'
import { cosineSimilarity, embed } from './embedding'
import { structureComplaint } from './structurer'

/** A processed report plus the vector the server keeps in `summary_vector`. */
export interface ReportRecord extends ProcessedReport {
  summary_vector: number[]
}

/** A raw complaint plus its `input_vector`. */
export interface ComplaintRecord extends RawComplaint {
  input_vector: number[] | null
  /** Similarity to the nearest report at ingest time — handy for demos. */
  nearest_similarity: number | null
}

export interface PipelineState {
  complaints: ComplaintRecord[]
  reports: ReportRecord[]
}

export interface RunOptions {
  similarityThreshold: number
  /** Per-stage delay in ms, so the trace is legible. 0 runs instantly. */
  stepDelayMs?: number
  onStep?: (steps: TraceStep[]) => void
}

const STAGE_LABELS: Record<TraceStage, string> = {
  ingest: 'Insert raw complaint',
  embed: 'Embed input text',
  search: 'Search nearest report',
  match: 'Link to existing report',
  structure: 'Structure via LLM',
  persist: 'Persist processed report',
}

function newId(): string {
  return crypto.randomUUID()
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Ordered trace scaffold; stages resolve to done/skipped as the run proceeds. */
function initialSteps(): TraceStep[] {
  const stages: TraceStage[] = ['ingest', 'embed', 'search', 'match', 'structure', 'persist']
  return stages.map((stage) => ({ stage, state: 'pending', label: STAGE_LABELS[stage] }))
}

export interface RunOutput {
  result: PipelineResult
  state: PipelineState
  steps: TraceStep[]
}

export async function runPipeline(
  rawText: string,
  state: PipelineState,
  options: RunOptions,
): Promise<RunOutput> {
  const { similarityThreshold, stepDelayMs = 420, onStep } = options
  const steps = initialSteps()

  const advance = (stage: TraceStage, state: TraceStep['state'], detail?: string) => {
    const step = steps.find((candidate) => candidate.stage === stage)
    if (step) {
      step.state = state
      if (detail !== undefined) step.detail = detail
    }
    onStep?.(steps.map((candidate) => ({ ...candidate })))
  }

  // --- ingest -------------------------------------------------------------
  advance('ingest', 'running')
  await delay(stepDelayMs)
  const complaintId = newId()
  const complaint: ComplaintRecord = {
    id: complaintId,
    raw_text: rawText,
    received_at: new Date().toISOString(),
    processed_report_id: null,
    status: 'pending',
    input_vector: null,
    nearest_similarity: null,
  }
  advance('ingest', 'done', `complaint ${complaintId.slice(0, 8)} · status pending`)

  // --- embed --------------------------------------------------------------
  advance('embed', 'running')
  await delay(stepDelayMs)
  const inputVector = embed(rawText)
  complaint.input_vector = inputVector
  advance('embed', 'done', `${inputVector.length}-dim input_vector stored`)

  // --- search -------------------------------------------------------------
  advance('search', 'running')
  await delay(stepDelayMs)
  let nearest: { report: ReportRecord; similarity: number } | null = null
  for (const report of state.reports) {
    const similarity = cosineSimilarity(inputVector, report.summary_vector)
    if (!nearest || similarity > nearest.similarity) {
      nearest = { report, similarity }
    }
  }
  complaint.nearest_similarity = nearest?.similarity ?? null
  advance(
    'search',
    'done',
    nearest
      ? `nearest ${nearest.similarity.toFixed(3)} vs threshold ${similarityThreshold.toFixed(2)}`
      : 'no reports yet — corpus is empty',
  )

  const complaints = [complaint, ...state.complaints]

  // --- Case B: close enough to an existing report --------------------------
  if (nearest && nearest.similarity >= similarityThreshold) {
    const match = nearest
    advance('structure', 'skipped', 'no LLM call needed — deduped')
    advance('match', 'running')
    await delay(stepDelayMs)

    complaint.status = 'matched'
    complaint.processed_report_id = match.report.id
    const reports = state.reports.map((report) =>
      report.id === match.report.id
        ? { ...report, match_count: report.match_count + 1 }
        : report,
    )

    advance('match', 'done', `report ${match.report.id.slice(0, 8)} match_count +1`)
    advance('persist', 'done', 'raw_complaints row updated')

    return {
      result: {
        outcome: 'matched',
        complaintId,
        reportId: match.report.id,
        similarity: match.similarity,
      },
      state: { complaints, reports },
      steps,
    }
  }

  // --- Case A: distinct issue, structure it --------------------------------
  advance('match', 'skipped', 'below threshold — treated as distinct')
  advance('structure', 'running')
  await delay(stepDelayMs * 2)
  const { structuredReport, canonicalSummary } = structureComplaint(rawText)
  advance('structure', 'done', `${structuredReport.category} · ${structuredReport.sentiment}`)

  advance('persist', 'running')
  await delay(stepDelayMs)
  const reportId = newId()
  const report: ReportRecord = {
    id: reportId,
    structured_report: structuredReport,
    canonical_summary: canonicalSummary,
    created_at: new Date().toISOString(),
    match_count: 0,
    summary_vector: embed(canonicalSummary),
  }
  complaint.status = 'new_report_created'
  complaint.processed_report_id = reportId
  advance('persist', 'done', `report ${reportId.slice(0, 8)} created`)

  return {
    result: {
      outcome: 'new_report_created',
      complaintId,
      reportId,
      similarity: nearest?.similarity ?? null,
    },
    state: { complaints, reports: [report, ...state.reports] },
    steps,
  }
}
