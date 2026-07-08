import type pg from 'pg';
import {
  resolveEmbeddingConfig,
  resolveLLMConfig,
  resolvePipelineConfig,
  type EmbeddingConfig,
  type LLMConfig,
  type PipelineConfig,
} from './config.js';
import {
  findNearestReport,
  insertProcessedReport,
  insertRawComplaint,
  linkComplaintToReport,
  setInputVector,
} from './db.js';
import { callOpenRouterEmbedding } from './embedding-client.js';
import { structureComplaint } from './llm-client.js';

export interface PipelineDeps {
  pool: pg.Pool;
  embeddingConfig?: EmbeddingConfig;
  llmConfig?: LLMConfig;
  pipelineConfig?: PipelineConfig;
}

export type PipelineResult =
  | {
      outcome: 'new_report_created'; 
      complaintId: string;
      reportId: string;
      nearestSimilarity: number | null;
    }
  | {
      outcome: 'matched'; 
      complaintId: string;
      reportId: string;
      similarity: number;
    };

export async function processRawComplaint(
  rawText: string,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const embeddingConfig = deps.embeddingConfig ?? resolveEmbeddingConfig();
  const llmConfig = deps.llmConfig ?? resolveLLMConfig();
  const { similarityThreshold } = deps.pipelineConfig ?? resolvePipelineConfig();
  const { pool } = deps;

  const complaintId = await insertRawComplaint(pool, rawText);

  const inputVector = await callOpenRouterEmbedding(rawText, embeddingConfig);
  await setInputVector(pool, complaintId, inputVector);

  const nearest = await findNearestReport(pool, inputVector);

  if (nearest && nearest.similarity >= similarityThreshold) {
    await linkComplaintToReport(pool, complaintId, nearest.reportId);
    return {
      outcome: 'matched',
      complaintId,
      reportId: nearest.reportId,
      similarity: nearest.similarity,
    };
  }

  const { structuredReport, canonicalSummary } = await structureComplaint(rawText, llmConfig);
  const summaryVector = await callOpenRouterEmbedding(canonicalSummary, embeddingConfig);
  const reportId = await insertProcessedReport(
    pool,
    complaintId,
    structuredReport,
    canonicalSummary,
    summaryVector,
  );

  return {
    outcome: 'new_report_created',
    complaintId,
    reportId,
    nearestSimilarity: nearest?.similarity ?? null,
  };
}
