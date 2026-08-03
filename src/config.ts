export interface EmbeddingConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

export interface PipelineConfig {
  similarityThreshold: number;
}

function resolveApiKey(override?: string): string {
  const apiKey = override ?? process.env.OPENROUTER_API_KEY ?? '';
  if (!apiKey) throw new Error('Missing OpenRouter API key (OPENROUTER_API_KEY)');
  return apiKey;
}

function resolveBaseUrl(override?: string): string {
  return override ?? process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
}

export function resolveEmbeddingConfig(overrides?: Partial<EmbeddingConfig>): EmbeddingConfig {
  const model = overrides?.model ?? process.env.OPENROUTER_EMBEDDING_MODEL;
  if (!model) {
    throw new Error(
      'No embedding model configured — set OPENROUTER_EMBEDDING_MODEL ' +
        'or pass { model } explicitly. This is a user choice, not a default.',
    );
  }

  // Embeddings may come from a different host than the structuring LLM — a
  // self-hosted text-embeddings-inference server, say, with the LLM still on
  // OpenRouter. Falls back to the shared base URL when unset.
  const baseUrl = overrides?.baseUrl ?? process.env.EMBEDDING_BASE_URL ?? resolveBaseUrl();

  // A self-hosted embedding server usually has no auth, so do not demand an
  // OpenRouter key just to talk to it. The header is still sent; local servers
  // ignore it.
  const isSelfHosted = Boolean(process.env.EMBEDDING_BASE_URL) || Boolean(overrides?.baseUrl);
  const apiKey = isSelfHosted
    ? (overrides?.apiKey ?? process.env.EMBEDDING_API_KEY ?? process.env.OPENROUTER_API_KEY ?? 'local')
    : resolveApiKey(overrides?.apiKey);

  return { apiKey, baseUrl, model };
}

export function resolveLLMConfig(overrides?: Partial<LLMConfig>): LLMConfig {
  const model = overrides?.model ?? process.env.OPENROUTER_MODEL;
  if (!model) {
    throw new Error(
      'No structuring model configured — set OPENROUTER_MODEL or pass { model } explicitly.',
    );
  }

  return {
    apiKey: resolveApiKey(overrides?.apiKey),
    baseUrl: resolveBaseUrl(overrides?.baseUrl),
    model,
    maxTokens: overrides?.maxTokens ?? 4_096,
    temperature: overrides?.temperature ?? 0,
  };
}

export function resolvePipelineConfig(overrides?: Partial<PipelineConfig>): PipelineConfig {
  const raw = overrides?.similarityThreshold ?? Number(process.env.SIMILARITY_THRESHOLD);
  if (!Number.isFinite(raw) || raw <= 0 || raw >= 1) {
    throw new Error(
      'SIMILARITY_THRESHOLD must be set to a value strictly between 0 and 1 — ' +
        'the cutoff needs empirical tuning on real data and has no default.',
    );
  }
  return { similarityThreshold: raw };
}
