import { chmodSync, mkdirSync } from "node:fs";

const dataDir = process.env.MAHORAGA_DATA_DIR || "/data";
const workerUrl = "http://127.0.0.1:8787";
const publicPort = Number(process.env.PORT || "3000");

const secretNames = [
  "ALPACA_API_KEY",
  "ALPACA_API_SECRET",
  "ALPACA_PAPER",
  "MAHORAGA_API_TOKEN",
  "KILL_SWITCH_SECRET",
  "LLM_PROVIDER",
  "LLM_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "XAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID",
  "CLOUDFLARE_AI_GATEWAY_ID",
  "CLOUDFLARE_AI_GATEWAY_TOKEN",
  "TWITTER_BEARER_TOKEN",
  "DISCORD_WEBHOOK_URL",
] as const;

mkdirSync(dataDir, { recursive: true });
const values = new Map<string, string>();
for (const name of secretNames) {
  const value = process.env[name];
  if (value) values.set(name, value);
}
if (!values.has("ALPACA_PAPER")) values.set("ALPACA_PAPER", "true");

// Wrangler loads local binding secrets from .dev.vars. The file is generated
// only inside the container; it is never included in the image or Git.
const varsPath = `${process.cwd()}/.dev.vars`;
await Bun.write(varsPath, [...values].map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n");
chmodSync(varsPath, 0o600);

const commonEnv = { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" };
// Wrangler requires Node.js. Invoke it with the real Node runtime from the
// image rather than bunx, which can fall back to Bun's Node compatibility.
const wrangler = ["node", "node_modules/wrangler/bin/wrangler.js"];
const migrate = Bun.spawnSync(
  [...wrangler, "d1", "migrations", "apply", "mahoraga-db", "--local", "--persist-to", dataDir, "--config", "wrangler.server.jsonc"],
  { cwd: process.cwd(), env: commonEnv, stdout: "inherit", stderr: "inherit" },
);
if (migrate.exitCode !== 0) throw new Error(`D1 migration failed (${migrate.exitCode})`);

const worker = Bun.spawn(
  [...wrangler, "dev", "--config", "wrangler.server.jsonc", "--ip", "127.0.0.1", "--port", "8787", "--persist-to", dataDir, "--test-scheduled", "--show-interactive-dev-session=false"],
  { cwd: process.cwd(), env: commonEnv, stdout: "inherit", stderr: "inherit" },
);

let ready = false;
for (let attempt = 0; attempt < 20; attempt++) {
  if (await Promise.race([worker.exited.then(() => true), Bun.sleep(1000).then(() => false)])) {
    throw new Error("Wrangler exited before becoming ready");
  }
  try {
    const response = await fetch(`${workerUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (response.ok) {
      ready = true;
      break;
    }
    console.error(`Wrangler health endpoint returned ${response.status}`);
  } catch (error) {
    if (attempt === 0 || attempt === 19) console.error("Wrangler health endpoint did not respond", error);
  }
}
if (!ready) {
  worker.kill();
  throw new Error("Wrangler health endpoint did not become ready");
}

function dueCrons(now: Date): string[] {
  const minute = now.getUTCMinutes();
  const hour = now.getUTCHours();
  const weekday = now.getUTCDay();
  const marketDay = weekday >= 1 && weekday <= 5;
  const crons: string[] = [];
  if (marketDay && hour >= 13 && hour <= 20 && minute % 5 === 0) crons.push("*/5 13-20 * * 1-5");
  if (marketDay && hour === 14 && minute === 0) crons.push("0 14 * * 1-5");
  if (marketDay && hour === 21 && minute === 30) crons.push("30 21 * * 1-5");
  if (hour === 5 && minute === 0) crons.push("0 5 * * *");
  if (minute === 0) crons.push("0 * * * *");
  return crons;
}

let lastMinute = "";
async function runScheduled(): Promise<void> {
  const now = new Date();
  const minuteKey = now.toISOString().slice(0, 16);
  if (minuteKey === lastMinute) return;
  lastMinute = minuteKey;
  for (const cron of dueCrons(now)) {
    try {
      const response = await fetch(`${workerUrl}/cdn-cgi/local/scheduled?cron=${encodeURIComponent(cron)}`);
      if (!response.ok) console.error(`Scheduled event ${cron} returned ${response.status}`);
    } catch (error) {
      console.error(`Scheduled event ${cron} failed`, error);
    }
  }
}

if (values.has("ALPACA_API_KEY") && values.has("ALPACA_API_SECRET")) {
  setInterval(() => void runScheduled(), 10_000);
  void runScheduled();
}

const server = Bun.serve({
  hostname: "0.0.0.0",
  port: publicPort,
  async fetch(request) {
    const url = new URL(request.url);
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    // The local scheduled-event test endpoint is for this process only.
    if (pathname.startsWith("/cdn-cgi/") || pathname.startsWith("/__scheduled")) {
      return new Response("Not found", { status: 404 });
    }
    url.protocol = "http:";
    url.hostname = "127.0.0.1";
    url.port = "8787";
    try {
      const upstreamRequest = new Request(url, request);
      upstreamRequest.headers.set("accept-encoding", "identity");
      const response = await fetch(upstreamRequest);
      const headers = new Headers(response.headers);
      // Bun fetch decodes compressed Worker responses but retains their
      // original encoding headers. Passing those headers to the browser makes
      // JavaScript and CSS fail to load with a decompression error.
      headers.delete("content-encoding");
      headers.delete("content-length");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return new Response("Worker unavailable", { status: 503 });
    }
  },
});

console.log(`MAHORAGA dashboard and API listening on internal port ${server.port}`);
let stopping = false;
worker.exited.then((code) => {
  if (!stopping) console.error(`Wrangler exited with code ${code}`);
  server.stop();
  process.exit(stopping ? 0 : (code || 1));
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    server.stop();
    worker.kill();
  });
}
