import pg from 'pg';
import type { StructuredReport } from './llm-client.js';

export type ComplaintStatus = 'pending' | 'matched' | 'new_report_created';

export interface SimilarityMatch {
  reportId: string;
  similarity: number;
}

export function createPool(connectionString?: string): pg.Pool {
  return new pg.Pool({
    connectionString:
      connectionString ??
      process.env.DATABASE_URL ??
      'postgres://postgres:postgres@localhost:5432/nimbrosa',
  });
}

export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

export async function insertRawComplaint(pool: pg.Pool, rawText: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO raw_complaints (raw_text, status) VALUES ($1, 'pending') RETURNING id`,
    [rawText],
  );
  return rows[0].id;
}

export async function setInputVector(
  pool: pg.Pool,
  complaintId: string,
  vector: number[],
): Promise<void> {
  await pool.query(`UPDATE raw_complaints SET input_vector = $1 WHERE id = $2`, [
    toVectorLiteral(vector),
    complaintId,
  ]);
}

export async function findNearestReport(
  pool: pg.Pool,
  inputVector: number[],
): Promise<SimilarityMatch | null> {
  const literal = toVectorLiteral(inputVector);
  const { rows } = await pool.query<{ id: string; similarity: number }>(
    `SELECT id, 1 - (summary_vector <=> $1) AS similarity
       FROM processed_reports
      ORDER BY summary_vector <=> $1
      LIMIT 1`,
    [literal],
  );
  if (rows.length === 0) return null;
  return { reportId: rows[0].id, similarity: Number(rows[0].similarity) };
}

/**
 * Arbitrary constant identifying the report-creation critical section.
 * All workers must use the same value for the lock to mean anything.
 */
const REPORT_CREATION_LOCK = 0x6e696d62;

export type FinalizeResult =
  | { outcome: 'new_report_created'; reportId: string }
  | { outcome: 'matched'; reportId: string; similarity: number };

export interface FinalizeParams {
  complaintId: string;
  inputVector: number[];
  similarityThreshold: number;
  structuredReport: StructuredReport;
  canonicalSummary: string;
  summaryVector: number[];
}

/**
 * Commits the outcome of a Case A complaint under an advisory lock, re-checking
 * for a nearest match first. The caller's earlier search happened before the LLM
 * and embedding calls, so a concurrent worker may have inserted a matching report
 * in the meantime; without the re-check both would insert duplicates of the same
 * underlying issue. The lock is transaction-scoped and covers only these queries,
 * not the model calls.
 */
export async function finalizeComplaint(
  pool: pg.Pool,
  params: FinalizeParams,
): Promise<FinalizeResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [REPORT_CREATION_LOCK]);

    const { rows: nearestRows } = await client.query<{ id: string; similarity: number }>(
      `SELECT id, 1 - (summary_vector <=> $1) AS similarity
         FROM processed_reports
        ORDER BY summary_vector <=> $1
        LIMIT 1`,
      [toVectorLiteral(params.inputVector)],
    );

    const nearest = nearestRows[0];
    if (nearest && Number(nearest.similarity) >= params.similarityThreshold) {
      await client.query(
        `UPDATE raw_complaints SET processed_report_id = $1, status = 'matched' WHERE id = $2`,
        [nearest.id, params.complaintId],
      );
      await client.query(`UPDATE processed_reports SET match_count = match_count + 1 WHERE id = $1`, [
        nearest.id,
      ]);
      await client.query('COMMIT');
      return { outcome: 'matched', reportId: nearest.id, similarity: Number(nearest.similarity) };
    }

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO processed_reports (structured_report, canonical_summary, summary_vector)
       VALUES ($1, $2, $3) RETURNING id`,
      [
        JSON.stringify(params.structuredReport),
        params.canonicalSummary,
        toVectorLiteral(params.summaryVector),
      ],
    );
    await client.query(`UPDATE raw_complaints SET status = 'new_report_created' WHERE id = $1`, [
      params.complaintId,
    ]);
    await client.query('COMMIT');
    return { outcome: 'new_report_created', reportId: rows[0].id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function linkComplaintToReport(
  pool: pg.Pool,
  complaintId: string,
  reportId: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE raw_complaints SET processed_report_id = $1, status = 'matched' WHERE id = $2`,
      [reportId, complaintId],
    );
    await client.query(`UPDATE processed_reports SET match_count = match_count + 1 WHERE id = $1`, [
      reportId,
    ]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export interface Paging {
  limit: number;
  offset: number;
}

interface Raw {
  id: string;
  raw_text: string;
  received_at: string;
  processed_report_id: string | null;
  status: string;
}

export async function getRaw(pool: pg.Pool, { limit, offset }: Paging): Promise<Raw[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<Raw>(
      `SELECT id, raw_text, received_at, processed_report_id, status
         FROM raw_complaints
        ORDER BY received_at DESC, id DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    await client.query('COMMIT');
    return rows;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

interface Processed {
  id: string;
  structured_report: StructuredReport;
  canonical_summary: string;
  created_at: string;  
  match_count: number;
}

export async function getProcessed(pool: pg.Pool, { limit, offset }: Paging): Promise<Processed[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<Processed> (
      `SELECT id, structured_report, canonical_summary, created_at, match_count
         FROM processed_reports
        ORDER BY created_at DESC, id DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    await client.query('COMMIT');
    return rows;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
