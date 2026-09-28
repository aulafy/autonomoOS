import { defineConfig } from "vite";
import { makeDemoData } from "./src/fixtures.js";
import { classifyDemoText } from "./src/local-classifier.js";

const fixture = makeDemoData(new Date("2026-09-28T07:00:00Z"));
const allowed = new Map(fixture.messages.filter(message => /^msg-[1-8]$/.test(message.id))
  .map(message => [message.id, message]));

export default defineConfig({
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
  plugins: [{
    name: "pymes-demo-classifier",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
        if (!pathname.startsWith("/api/demo-classify")) return next();
        const headers = { "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
        const send = (status: number, body: Record<string, unknown>) => {
          res.writeHead(status, headers);
          res.end(JSON.stringify(body));
        };
        if (req.method !== "POST") return send(405, { error: "METHOD_NOT_ALLOWED" });
        if (req.headers.origin && req.headers.origin !== "http://127.0.0.1:5174") {
          return send(403, { error: "ORIGIN_NOT_ALLOWED" });
        }
        const id = pathname.slice("/api/demo-classify/".length);
        const message = pathname.startsWith("/api/demo-classify/") ? allowed.get(id) : null;
        if (!message) return send(404, { error: "DEMO_MESSAGE_NOT_FOUND" });
        try {
          const result = await classifyDemoText({ text: message.text,
            model: process.env.PYMES_LOCAL_MODEL ?? undefined });
          return send(200, { messageId: id, fixtureOnly: true,
            proposed: result.proposal, model: result.model,
            latencyMs: result.latencyMs, accepted: false });
        } catch {
          return send(503, { error: "LOCAL_MODEL_UNAVAILABLE" });
        }
      });
    }
  }]
});
