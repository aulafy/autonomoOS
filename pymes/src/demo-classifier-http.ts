import type { IncomingMessage, ServerResponse } from "node:http";
import { makeDemoData } from "./fixtures.js";
import { classifyDemoText } from "./local-classifier.js";

export function createDemoClassifierHandler(origin: string, classify = classifyDemoText) {
  const fixture = makeDemoData(new Date("2026-09-28T07:00:00Z"));
  const allowed = new Map(fixture.messages.filter(message => /^msg-[1-8]$/.test(message.id))
    .map(message => [message.id, message]));
  let busy = false;
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    const pathname = new URL(request.url ?? "/", origin).pathname;
    if (!pathname.startsWith("/api/demo-classify")) return false;
    const send = (status: number, body: Record<string, unknown>) => {
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      response.end(JSON.stringify(body));
      return true;
    };
    if (request.method !== "POST") return send(405, { error: "METHOD_NOT_ALLOWED" });
    if (request.headers.origin !== origin) return send(403, { error: "ORIGIN_NOT_ALLOWED" });
    const id = pathname.slice("/api/demo-classify/".length);
    const message = pathname.startsWith("/api/demo-classify/") ? allowed.get(id) : undefined;
    if (!message) return send(404, { error: "DEMO_MESSAGE_NOT_FOUND" });
    if (busy) return send(429, { error: "LOCAL_MODEL_BUSY" });
    busy = true;
    try {
      const result = await classify({ text: message.text, model: process.env.PYMES_LOCAL_MODEL,
        baseUrl: process.env.PYMES_LOCAL_LLM_URL });
      return send(200, { messageId: id, fixtureOnly: true, proposed: result.proposal,
        model: result.model, latencyMs: result.latencyMs, accepted: false });
    } catch { return send(503, { error: "LOCAL_MODEL_UNAVAILABLE" }); }
    finally { busy = false; }
  };
}
