/**
 * Single-port entry point: the built frontend, the read API and the webhook
 * receiver all served from one origin (4040 by default) instead of 5173 / 3001
 * / 3000. Same origin means no CORS and no per-service ports to remember.
 *
 *   GET  /                 -> src/web/dist (SPA, falls back to index.html)
 *   GET  /api/health       -> which capabilities are actually wired up
 *   GET  /api/raw          -> raw_complaints
 *   GET  /api/processed    -> processed_reports
 *   POST /api/webhook      -> signature-verified ingest (queued via pg-boss)
 *
 * Each capability degrades on its own: with no database the API routes answer
 * 503 and the frontend still loads and runs its local simulation; with no
 * WEBHOOK_SECRET_KEY the webhook route is simply not mounted.
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { createPool, getProcessed, getRaw } from './db.js';

const PORT = Number(process.env.PORT) || 4040;

const HERE = path.dirname(fileURLToPath(import.meta.url));
/**
 * Resolved from the source tree, not the compiled output: `tsc` mirrors src/
 * into dist/, so this file may run from either dist/src/ or src/. Walk up until
 * a directory containing src/web/dist is found.
 */
/** Running from src/ (tsx). */
const WEB_DIST_FROM_SRC = path.resolve(HERE, 'web', 'dist');
/** Running from dist/src/ (compiled). */
const WEB_DIST_FROM_DIST = path.resolve(HERE, '..', '..', 'src', 'web', 'dist');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function resolveWebRoot(): Promise<string | null> {
  for (const candidate of [WEB_DIST_FROM_SRC, WEB_DIST_FROM_DIST]) {
    try {
      const stats = await stat(path.join(candidate, 'index.html'));
      if (stats.isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Serve a file from the built frontend. Unknown paths fall back to index.html
 * so client-side routes keep working on a hard refresh.
 */
async function serveStatic(
  root: string,
  urlPath: string,
  res: ServerResponse,
): Promise<void> {
  const relative = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const target = path.resolve(root, relative);

  // Never serve outside the build directory, whatever the URL contains.
  const withinRoot = target === root || target.startsWith(root + path.sep);
  let filePath = withinRoot ? target : path.join(root, 'index.html');

  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) filePath = path.join(filePath, 'index.html');
    await stat(filePath);
  } catch {
    filePath = path.join(root, 'index.html');
  }

  const contentType = MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  // Hashed asset filenames are safe to cache; index.html must not be.
  const isHashedAsset = filePath.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(filePath).pipe(res);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** Enqueues verified webhook payloads. Absent when the secret is unset. */
interface WebhookSupport {
  verify: (headers: Record<string, string>, rawBody: string) => void;
  enqueue: (text: string) => Promise<void>;
}

/**
 * Wired up only when WEBHOOK_SECRET_KEY and DATABASE_URL are present. Both
 * imports are dynamic: ./webhook.js throws at module load without the secret,
 * and pg-boss opens a connection as soon as it starts.
 */
async function initWebhook(): Promise<WebhookSupport | null> {
  if (!process.env.WEBHOOK_SECRET_KEY || !process.env.DATABASE_URL) return null;

  try {
    const [{ verifyHeaders }, { PgBoss }, { ingestComplaint }] = await Promise.all([
      import('./webhook.js'),
      import('pg-boss'),
      import('./index.js'),
    ]);

    const INPUT_QUEUE = 'input_queue';
    const boss = new PgBoss(process.env.DATABASE_URL);
    await boss.start();
    await boss.createQueue(INPUT_QUEUE);
    await boss.work<{ text: string }>(INPUT_QUEUE, async ([job]) => {
      await ingestComplaint(job.data.text);
    });

    return {
      verify: (headers, rawBody) => {
        const id = headers['webhook-id'];
        const timestamp = headers['webhook-timestamp'];
        const signature = headers['webhook-signature'];
        if (!id || !timestamp || !signature) throw new Error('Missing webhook headers');
        verifyHeaders(
          {
            'webhook-id': id,
            'webhook-timestamp': timestamp,
            'webhook-signature': signature,
          },
          rawBody,
        );
      },
      enqueue: async (text) => {
        await boss.send(INPUT_QUEUE, { text });
      },
    };
  } catch (err) {
    console.warn(`webhook ingest disabled: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  pool: pg.Pool,
  webhook: WebhookSupport | null,
): Promise<boolean> {
  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      database: Boolean(process.env.DATABASE_URL),
      webhook: Boolean(webhook),
    });
    return true;
  }

  if (req.method === 'GET' && (pathname === '/api/raw' || pathname === '/api/processed')) {
    try {
      const rows = pathname === '/api/raw' ? await getRaw(pool) : await getProcessed(pool);
      sendJson(res, 200, rows);
    } catch (err) {
      console.error(err);
      // The frontend treats a failure here as "run the local simulation".
      sendJson(res, 503, { error: 'database unavailable' });
    }
    return true;
  }

  if (pathname === '/api/webhook') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'method not allowed' });
      return true;
    }
    if (!webhook) {
      sendJson(res, 503, { error: 'webhook ingest not configured' });
      return true;
    }

    const rawBody = await readBody(req);
    try {
      webhook.verify(req.headers as Record<string, string>, rawBody);
    } catch {
      sendJson(res, 401, { error: 'invalid signature' });
      return true;
    }

    try {
      const parsed = JSON.parse(rawBody) as { text?: unknown };
      if (typeof parsed.text !== 'string' || !parsed.text.trim()) {
        sendJson(res, 400, { error: 'body must be { "text": "<complaint>" }' });
        return true;
      }
      await webhook.enqueue(parsed.text);
      sendJson(res, 202, { queued: true });
    } catch (err) {
      console.error(err);
      sendJson(res, 400, { error: 'malformed request' });
    }
    return true;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { error: 'not found' });
    return true;
  }

  return false;
}

async function main(): Promise<void> {
  const pool = createPool();
  const webhook = await initWebhook();
  const webRoot = await resolveWebRoot();

  const server = createServer((req, res) => {
    void (async () => {
      const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;

      try {
        if (await handleApi(req, res, pathname, pool, webhook)) return;

        if (!webRoot) {
          sendJson(res, 503, {
            error: 'frontend not built — run `npm --prefix src/web run build`',
          });
          return;
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: 'method not allowed' });
          return;
        }

        await serveStatic(webRoot, pathname, res);
      } catch (err) {
        console.error(err);
        if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
        else res.end();
      }
    })();
  });

  server.listen(PORT, () => {
    console.log(`nimbrosa listening on http://localhost:${PORT}`);
    console.log(`  frontend  ${webRoot ? 'served from ' + webRoot : 'NOT BUILT (api only)'}`);
    console.log(`  read api  /api/raw, /api/processed`);
    console.log(`  webhook   ${webhook ? 'POST /api/webhook' : 'disabled (needs WEBHOOK_SECRET_KEY + DATABASE_URL)'}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
