# Nimbrosa web — pipeline simulator

A React + Vite dashboard for the complaint deduplication pipeline. Submit a raw
complaint and watch it move through the same stages as `processRawComplaint()`
in `src/pipeline.ts`: insert → embed → nearest-report search → match or
structure → persist.

## Running it

```bash
npm ci
npm run dev     # http://localhost:5173
```

It needs nothing else — no database, no API key. Everything runs against a local
simulation by default.

## Two modes

The app picks its data source at startup:

- **Live** — if `/api/raw` and `/api/processed` return rows, the dashboard
  hydrates from them.
- **Simulation** — otherwise everything runs client-side against a seeded
  corpus.

The API path is same-origin `/api` by default (override with
`VITE_API_BASE_URL`); in dev, Vite proxies it to `http://localhost:3001`, which
`API_TARGET` can repoint.

**Live mode needs a gateway in front of the read API.** `src/api.ts` requires a
bearer `API_TOKEN`, and a browser bundle cannot hold a secret — anything shipped
to the client is public. So hydration works only behind something that injects
the `Authorization` header server-side. Without it the fetch 401s and the
dashboard falls back to simulation, which is the intended default.

Because the read API is GET-only, **submitting a complaint in the UI always runs
the local simulation**, even in live mode. Nothing is written back to Postgres —
real ingestion goes through the webhook receiver.

## What is simulated

| Real pipeline | Stand-in |
| --- | --- |
| OpenRouter embeddings (`src/embedding-client.ts`) | `src/lib/embedding.ts` — stemmed, hashed bag-of-words, L2-normalised to 96 dims |
| LLM structuring (`src/llm-client.ts`) | `src/lib/structurer.ts` — keyword rules for category and sentiment |
| pgvector `<=>` nearest-neighbour search | linear cosine scan in `src/lib/pipeline.ts` |

The stand-in embedder captures **lexical overlap, not meaning**, so its
similarity scores live in a different range from real embeddings. The
`SIMILARITY_THRESHOLD` slider defaults to `0.40`, tuned against the built-in
samples: true duplicates score 0.41–0.56, unrelated complaints stay under 0.26.
The `SIMILARITY_THRESHOLD` in `.env` needs its own tuning against real vectors.

## Layout

- `src/lib/` — the simulated pipeline and its parts
- `src/components/` — composer, trace, report list, raw feed, stats
- `src/types.ts` — mirrors the backend row shapes in `src/db.ts`
