import pg from 'pg';
import type { StructuredReport } from './llm-client.js';
import { CLIENT_RENEG_LIMIT } from 'node:tls';

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

export async function insertProcessedReport(
  pool: pg.Pool,
  complaintId: string,
  structuredReport: StructuredReport,
  canonicalSummary: string,
  summaryVector: number[],
): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO processed_reports (structured_report, canonical_summary, summary_vector)
       VALUES ($1, $2, $3) RETURNING id`,
      [JSON.stringify(structuredReport), canonicalSummary, toVectorLiteral(summaryVector)],
    );
    await client.query(`UPDATE raw_complaints SET status = 'new_report_created' WHERE id = $1`, [
      complaintId,
    ]);
    await client.query('COMMIT');
    return rows[0].id;
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

interface Raw {
  id: string;
  raw_text: string;
  received_at: string;
  processed_report_id: string;
  status: string;
}

export async function getRaw(pool: pg.Pool): Promise<Raw[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await pool.query<Raw>(
      `SELECT id, raw_text, received_at, processed_report_id, status FROM raw_complaints`,
    );
    await client.query('COMMIT')
    return rows;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err
  } finally {
    client.release()
  }
}

interface Processed {

}
