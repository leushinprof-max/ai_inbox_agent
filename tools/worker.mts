import { createServer } from "node:http";
import { setTimeout } from "node:timers/promises";
import { adminClient } from "../src/server/admin";
import { runNextJob } from "../src/server/runtime";
import { createInboxModel } from "../src/integrations/ai/classify";

const db = adminClient();
const model = createInboxModel(
  process.env.OPENAI_API_KEY,
  process.env.INBOX_MODEL,
);
let stopping = false;
let lastCycle = Date.now();
let healthy = true;
const port = Number(process.env.PORT ?? 43601);
const server = createServer(async (req, res) => {
  if (req.url !== "/health" && req.url !== "/ready") {
    res.writeHead(404).end();
    return;
  }
  let ready =
    healthy &&
    Date.now() - lastCycle < 180000 &&
    !!process.env.OPENAI_API_KEY &&
    Buffer.from(process.env.INBOX_ENCRYPTION_KEY ?? "", "base64").length === 32;
  if (req.url === "/ready") {
    const result = await db.from("workspaces").select("id").limit(1);
    ready = ready && !result.error;
  }
  res.writeHead(req.url === "/health" || ready ? 200 : 503, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(
    JSON.stringify({
      ready,
      version: process.env.RAILWAY_GIT_COMMIT_SHA ?? "local",
    }),
  );
});
server.listen(port, "0.0.0.0");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
  });
while (!stopping) {
  try {
    const worked = await runNextJob({ db, model });
    healthy = true;
    lastCycle = Date.now();
    if (!worked) await setTimeout(1500);
  } catch {
    healthy = false;
    lastCycle = Date.now();
    console.error("Worker cycle failed; retrying database access.");
    await setTimeout(5000);
  }
}
server.close();
