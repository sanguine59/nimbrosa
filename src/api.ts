import { createServer } from "http";
import { timingSafeEqual } from "crypto";
import { getRaw, getProcessed, createPool, type Paging } from "./db.js";

const API_PORT = parseInt(process.env.API_PORT ?? '', 10) || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function resolveApiToken(): string {
  const token = process.env.API_TOKEN;
  if (!token) {
    throw new Error(
      'Missing API_TOKEN. This API serves raw customer complaints, so it refuses ' +
        'to start without one. Set API_TOKEN to a long random value.',
    );
  }
  return token;
}

function isAuthorized(header: string | undefined, token: string): boolean {
  const prefix = 'Bearer ';
  if (!header || !header.startsWith(prefix)) return false;

  const provided = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function parsePaging(url: URL): Paging | null {
  const rawLimit = url.searchParams.get('limit');
  const rawOffset = url.searchParams.get('offset');

  const limit = rawLimit === null ? DEFAULT_LIMIT : Number(rawLimit);
  const offset = rawOffset === null ? 0 : Number(rawOffset);

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return null;
  if (!Number.isInteger(offset) || offset < 0) return null;

  return { limit, offset };
}

async function main() {
  const apiToken = resolveApiToken();
  const pool = createPool();

  // Without a listener, an idle client losing its connection is an unhandled
  // 'error' event and terminates the process. Requests recover on their own.
  pool.on('error', (err) => console.error('idle client error', err));

  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    // Unauthenticated on purpose: container healthchecks have no token.
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, {'Content-Type': 'application/json'}).end('{"status":"ok"}');
      return;
    }

    if (!isAuthorized(req.headers.authorization, apiToken)) {
      res.writeHead(401, {'WWW-Authenticate': 'Bearer'}).end();
      return;
    }

    if (req.method === 'GET' && (url.pathname === '/raw' || url.pathname === '/processed')) {
      const paging = parsePaging(url);
      if (!paging) {
        res.writeHead(400, {'Content-Type': 'application/json'})
          .end(JSON.stringify({ error: `limit must be 1-${MAX_LIMIT}, offset must be >= 0` }));
        return;
      }

      try {
        const rows = url.pathname === '/raw'
          ? await getRaw(pool, paging)
          : await getProcessed(pool, paging);
        res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(rows));
      } catch (err) {
        console.error(err);
        res.writeHead(500).end();
      }
      return;
    }

    res.writeHead(404).end();
  });

  server.listen(API_PORT, () => console.log(`listening on :${API_PORT}`));

  let shuttingDown = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`${signal} received, shutting down`);

      server.close(async () => {
        try {
          await pool.end();
        } catch (err) {
          console.error('error during shutdown', err);
        } finally {
          process.exit(0);
        }
      });
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
