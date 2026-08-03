/**
 * Read-only client for the backend in src/api.ts. When that server is running
 * the dashboard hydrates from real rows; otherwise the app stays in simulation
 * mode. The endpoints are GET-only, so submitting a complaint always runs
 * against the local simulation.
 */

import type { ProcessedReport, RawComplaint } from '../types'
import type { ComplaintRecord, PipelineState, ReportRecord } from './pipeline'
import { embed } from './embedding'

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3001'

const TIMEOUT_MS = 2500

async function getJson<T>(path: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`${path} responded ${response.status}`)
    }
    return (await response.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Vectors are not exposed by the API, so re-derive them locally from the stored
 * text. That keeps similarity search working against live rows, with the caveat
 * that these are stand-in vectors, not the ones the server computed.
 */
export async function fetchLiveState(): Promise<PipelineState> {
  const [raw, processed] = await Promise.all([
    getJson<RawComplaint[]>('/raw'),
    getJson<ProcessedReport[]>('/processed'),
  ])

  const reports: ReportRecord[] = processed.map((report) => ({
    ...report,
    match_count: Number(report.match_count ?? 0),
    summary_vector: embed(report.canonical_summary),
  }))

  const complaints: ComplaintRecord[] = raw.map((complaint) => ({
    ...complaint,
    processed_report_id: complaint.processed_report_id ?? null,
    input_vector: embed(complaint.raw_text),
    nearest_similarity: null,
  }))

  const byNewest = (a: { at: string }, b: { at: string }) => (a.at < b.at ? 1 : -1)
  complaints.sort((a, b) => byNewest({ at: a.received_at }, { at: b.received_at }))
  reports.sort((a, b) => byNewest({ at: a.created_at }, { at: b.created_at }))

  return { complaints, reports }
}
