import { createServer, IncomingMessage, type IncomingHttpHeaders } from "http";
import { PgBoss } from "pg-boss";
import { verifyHeaders, type WebhookHeaders } from "./webhook.js";
import { ingestComplaint } from "./index.js";

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
  const boss = new PgBoss(dbUrl as string);
  await boss.start();
  await boss.createQueue(INPUT_QUEUE);

  await boss.work<{ text: string }>(INPUT_QUEUE, async ([job]) => {
    await ingestComplaint(job.data.text);
  });

  const server = createServer(async (req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }

    try {
      const rawBody = await readBody(req);

      verifyHeaders(normalizeHeaders(req.headers), rawBody);

      const parsed = JSON.parse(rawBody) as { text: string };
      if (!parsed.text || typeof parsed.text !== "string") {
        res.writeHead(400).end();
        return;
      }

      await boss.send(INPUT_QUEUE, { text: parsed.text });

      res.writeHead(202).end();
    } catch (err) {
      res.writeHead(401).end();
    }
  });

  server.listen(WEBHOOK_SERVER_PORT, () => console.log(`listening on :${WEBHOOK_SERVER_PORT}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
