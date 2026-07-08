import { createPool } from './db.js';
import { processRawComplaint, type PipelineResult } from './pipeline.js';

export { processRawComplaint } from './pipeline.js';
export * from './config.js';

export async function ingestComplaint(rawText: string): Promise<PipelineResult> {
  const pool = createPool();
  try {
    return await processRawComplaint(rawText, { pool });
  } finally {
    await pool.end();
  }
}
