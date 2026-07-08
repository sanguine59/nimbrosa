import type { EmbeddingConfig } from './config.js';
import { resilientFetch, validateBaseUrl } from './http.js';

export async function callOpenRouterEmbedding(
  text: string,
  config: EmbeddingConfig,
): Promise<number[]> {
  validateBaseUrl(config.baseUrl);
  const url = `${config.baseUrl.replace(/\/+$/, '')}/embeddings`;

  const response = await resilientFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model: config.model, input: text }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown error');
    throw new Error(
      `OpenRouter embeddings error (${response.status}): ${errorText.slice(0, 500)}`,
    );
  }

  const json = (await response.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const embedding = json.data?.[0]?.embedding;
  if (!embedding || !Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('OpenRouter returned no embedding vector');
  }

  return embedding;
}
