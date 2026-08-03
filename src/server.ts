import { createServer, IncomingMessage, type IncomingHttpHeaders } from "http";
import { PgBoss } from "pg-boss";
import { verifyHeaders, resolveWebhookConfig, type WebhookHeaders } from "./webhook.js";
import { createPool } from "./db.js";
import { processRawComplaint } from "./pipeline.js";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) throw new Error("Missing DATABASE_URL");

const INPUT_QUEUE = "input_queue";

function normalizeHeaders(headers: IncomingHttpHeaders): WebhookHeaders {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signature = headers["webhook-signature"];

  if (typeof id !== "string" || typeof timestamp !== "string" || typeof signature !== "string") {
    throw new Error("Missing or malformed webhook headers");
  }

  return {
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": signature,
  };
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const WEBHOOK_SERVER_PORT = parseInt(process.env.WEBHOOK_SERVER_PORT  ?? '',10) || 3000

async function main() {
  const webhookConfig = resolveWebhookConfig();

  const boss = new PgBoss(dbUrl as string);
  await boss.start();
  await boss.createQueue(INPUT_QUEUE);

  const pool = createPool(dbUrl);

  await boss.work<{ text: string }>(INPUT_QUEUE, async ([job]) => {
    await processRawComplaint(job.data.text, { pool });
  });

  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" }).end('{"status":"ok"}');
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }

    let rawBody: string;
    try {
      rawBody = await readBody(req);
    } catch (err) {
      console.error("failed to read request body", err);
      res.writeHead(400).end();
      return;
    }

    try {
      verifyHeaders(normalizeHeaders(req.headers), rawBody, webhookConfig);
    } catch (err) {
      console.warn("webhook signature rejected:", (err as Error).message);
      res.writeHead(401).end();
      return;
    }

    let parsed: { text?: unknown };
    try {
      parsed = JSON.parse(rawBody) as { text?: unknown };
    } catch {
      res.writeHead(400).end();
      return;
    }

    if (typeof parsed.text !== "string" || !parsed.text.trim()) {
      res.writeHead(400).end();
      return;
    }

    const text = parsed.text;

    try {
      await boss.send(INPUT_QUEUE, { text });
    } catch (err) {
      // Enqueue failures are ours, not the sender's. Returning 401 here would
      // tell the sender its credentials are wrong and stop it retrying, turning
      // an outage into silent data loss. 503 keeps the delivery retryable.
      console.error("failed to enqueue complaint", err);
      res.writeHead(503, { "Retry-After": "30" }).end();
      return;
    }

    res.writeHead(202).end();
  });

  server.listen(WEBHOOK_SERVER_PORT, () => console.log(`listening on :${WEBHOOK_SERVER_PORT}`));

  let shuttingDown = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`${signal} received, shutting down`);

      server.close(async () => {
        try {
          await boss.stop({ graceful: true });
          await pool.end();
        } catch (err) {
          console.error("error during shutdown", err);
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
