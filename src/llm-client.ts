import type { LLMConfig } from './config.js';
import { resilientFetch, validateBaseUrl } from './http.js';

export interface StructuredReport {
  title: string;
  category: string;
  sentiment: 'negative' | 'neutral' | 'positive';
  description: string;
}

export interface StructuringResult {
  structuredReport: StructuredReport;
  canonicalSummary: string;
}

const SYSTEM_PROMPT = `You are a customer-complaint structuring engine. Given one raw, unstructured customer complaint, produce:

1. A structured report: a short title, a category (a concise product/issue area label), the customer's sentiment (negative | neutral | positive), and a factual description of the issue.
2. A canonical summary: 1-3 sentences capturing the core issue in neutral wording. It is used to match future complaints about the same underlying issue, so describe WHAT is wrong, not who reported it or how they phrased it. Keep it short and information-dense.

Respond only with JSON matching the provided schema.`;

const RESPONSE_SCHEMA = {
  name: 'complaint_report',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['structured_report', 'canonical_summary'],
    properties: {
      structured_report: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'category', 'sentiment', 'description'],
        properties: {
          title: { type: 'string' },
          category: { type: 'string' },
          sentiment: { type: 'string', enum: ['negative', 'neutral', 'positive'] },
          description: { type: 'string' },
        },
      },
      canonical_summary: { type: 'string' },
    },
  },
} as const;

const SENTIMENTS = new Set(['negative', 'neutral', 'positive']);

function parseStructuringResponse(content: string): StructuringResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('LLM structuring output is not valid JSON');
  }

  const obj = parsed as Record<string, unknown>;
  const report = obj?.structured_report as Record<string, unknown> | undefined;
  const summary = obj?.canonical_summary;

  if (
    !report ||
    typeof report.title !== 'string' ||
    !report.title.trim() ||
    typeof report.category !== 'string' ||
    !report.category.trim() ||
    typeof report.sentiment !== 'string' ||
    !SENTIMENTS.has(report.sentiment) ||
    typeof report.description !== 'string' ||
    !report.description.trim() ||
    typeof summary !== 'string' ||
    !summary.trim()
  ) {
    throw new Error('LLM structuring output failed schema validation');
  }

  return {
    structuredReport: {
      title: report.title,
      category: report.category,
      sentiment: report.sentiment as StructuredReport['sentiment'],
      description: report.description,
    },
    canonicalSummary: summary.trim(),
  };
}

export async function structureComplaint(
  rawText: string,
  config: LLMConfig,
): Promise<StructuringResult> {
  validateBaseUrl(config.baseUrl);
  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const response = await resilientFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_completion_tokens: config.maxTokens,
      temperature: config.temperature,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: rawText },
      ],
      response_format: { type: 'json_schema', json_schema: RESPONSE_SCHEMA },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(`OpenRouter LLM error (${response.status}): ${errorText.slice(0, 500)}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM returned empty response');

  return parseStructuringResponse(content);
}
