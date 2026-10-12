/**
 * Stand-in for the OpenRouter embedding call (src/embedding-client.ts).
 *
 * Real embeddings need an API key and network access, which a demo should not
 * require. This is a deterministic hashed bag-of-words: token counts are folded
 * into a fixed-width vector and L2-normalised, so cosine similarity behaves the
 * way the pipeline expects — complaints that share vocabulary land close
 * together, unrelated ones do not. It captures lexical overlap only, not
 * meaning, which is the one thing to keep in mind when reading the numbers.
 */

export const EMBEDDING_DIMENSIONS = 96

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can', 'did',
  'do', 'does', 'for', 'from', 'had', 'has', 'have', 'i', 'if', 'in', 'is',
  'it', 'its', 'me', 'my', 'no', 'not', 'of', 'on', 'or', 'so', 'that', 'the',
  'then', 'there', 'they', 'this', 'to', 'was', 'were', 'what', 'when', 'why',
  'will', 'with', 'would', 'you', 'your',
])

/** Small, fast, stable string hash (FNV-1a). */
function hash(token: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < token.length; i += 1) {
    h ^= token.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Crude suffix stripper. Real embeddings handle morphology on their own; here
 * it is what lets "charged" / "charges" / "charge" land in the same bucket,
 * which is most of what makes paraphrased complaints look similar.
 */
function stem(token: string): string {
  let stemmed = token
  for (const suffix of ['ingly', 'edly', 'ing', 'ely', 'ed', 'ly', 'es', 's']) {
    if (stemmed.length > suffix.length + 2 && stemmed.endsWith(suffix)) {
      stemmed = stemmed.slice(0, -suffix.length)
      break
    }
  }
  // "cancell" -> "cancel", "stopp" -> "stop"
  if (/(.)\1$/.test(stemmed) && stemmed.length > 3) {
    stemmed = stemmed.slice(0, -1)
  }
  return stemmed
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token))
}

export function embed(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0)
  // Stem only here: callers that display tokens (the structurer's canonical
  // summary) want readable words, the vector wants collapsed morphology.
  const tokens = tokenize(text).map(stem)

  for (const token of tokens) {
    const h = hash(token)
    // Two buckets per token reduces the damage from a single collision.
    vector[h % EMBEDDING_DIMENSIONS] += 1
    vector[(h >>> 7) % EMBEDDING_DIMENSIONS] += 0.5
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (norm === 0) return vector
  return vector.map((value) => value / norm)
}

/** Both inputs are unit vectors from `embed`, so this is a plain dot product. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  for (let i = 0; i < a.length && i < b.length; i += 1) {
    dot += a[i] * b[i]
  }
  return dot
}
