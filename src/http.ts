export function validateBaseUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('Invalid base URL: must be a well-formed http:// or https:// URL');
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error(`Base URL must use http:// or https:// (got ${parsed.protocol})`);
  }

  if (parsed.protocol === 'http:') {
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
      throw new Error(
        `Insecure http:// base URLs are only allowed for localhost. ` +
          `Use https:// for remote endpoints (got ${parsed.origin})`,
      );
    }
  }
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  capDelayMs?: number;
  requestTimeoutMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number, response: Response | undefined, opts: Required<RetryOptions>): number {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, opts.capDelayMs);
    }
  }
  const exp = Math.min(opts.baseDelayMs * 2 ** (attempt - 1), opts.capDelayMs);
  return Math.random() * exp;
}

export async function resilientFetch(
  url: string,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const opts: Required<RetryOptions> = {
    maxAttempts: options.maxAttempts ?? 3,
    baseDelayMs: options.baseDelayMs ?? 2_000,
    capDelayMs: options.capDelayMs ?? 30_000,
    requestTimeoutMs: options.requestTimeoutMs ?? 60_000,
  };

  let lastError: unknown;
  let lastResponse: Response | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(opts.requestTimeoutMs),
      });
    } catch (err) {
      lastError = err;
      if (attempt < opts.maxAttempts) await sleep(retryDelayMs(attempt, undefined, opts));
      continue;
    }

    if (response.status !== 429 && response.status < 500) {
      return response; 
    }

    lastResponse = response;
    if (attempt < opts.maxAttempts) {
      await response.body?.cancel().catch(() => {});
      await sleep(retryDelayMs(attempt, response, opts));
    }
  }

  if (lastResponse) return lastResponse;
  throw new Error(
    `Request to ${new URL(url).origin} failed after ${opts.maxAttempts} attempts: ` +
      (lastError instanceof Error ? lastError.message : String(lastError)),
  );
}
