# Nimbrosa web — pipeline simulator

A React + Vite dashboard for the complaint deduplication pipeline. Submit a raw
complaint and watch it move through the same stages as `processRawComplaint()`
in `src/pipeline.ts`: insert → embed → nearest-report search → match or
structure → persist.

```bash
npm install
npm run dev     # http://localhost:5173
```

## Two modes

The app picks its data source at startup:

- **Live** — if the read API (`src/api.ts`) is reachable on `http://localhost:3001`
  and has rows, the dashboard hydrates from `/raw` and `/processed`.
- **Simulation** — otherwise everything runs client-side against a seeded
  corpus. No database, no API key.

Override the API origin with `VITE_API_BASE_URL`.

Because the API is GET-only, **submitting a complaint always runs the local
simulation**, even in live mode. Nothing is written back to Postgres.

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
