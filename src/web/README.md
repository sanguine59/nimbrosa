# Nimbrosa web — pipeline simulator

A React + Vite dashboard for the complaint deduplication pipeline. Submit a raw
complaint and watch it move through the same stages as `processRawComplaint()`
in `src/pipeline.ts`: insert → embed → nearest-report search → match or
structure → persist.

## Running it

Everything is served from one port by `src/serve.ts` (default **4040**):

```bash
npm --prefix src/web ci && npm --prefix src/web run build   # or: npm run build:web
npm run serve                                               # http://localhost:4040
```

For frontend work with hot reload, run the Vite dev server alongside it. It
proxies `/api` to 4040, so the app talks to the same paths in both modes:

```bash
npm run dev     # http://localhost:5173
```

Point the proxy elsewhere with `API_TARGET`.

## Two modes

The app picks its data source at startup:

- **Live** — if `/api/raw` and `/api/processed` return rows, the dashboard
  hydrates from them.
- **Simulation** — otherwise everything runs client-side against a seeded
  corpus. No database, no API key.

The API is same-origin (`/api`) by default; override with `VITE_API_BASE_URL`.

Because the read API is GET-only, **submitting a complaint in the UI always runs
the local simulation**, even in live mode. Nothing is written back to Postgres —
real ingestion goes through `POST /api/webhook`.

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
