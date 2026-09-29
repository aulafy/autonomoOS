import { createServer } from "node:http";
import { WorkspaceApi } from "./workspace-api.js";
import { handlePymesRequest } from "./api-server.js";
import { SqliteWorkspaceRepository } from "./workspace-store-sqlite.js";

const port = Number(process.env.PYMES_API_PORT ?? 8790);
const host = process.env.PYMES_API_HOST ?? "127.0.0.1";
const token = process.env.PYMES_API_BOOTSTRAP_TOKEN;
const tenantId = process.env.PYMES_API_BOOTSTRAP_TENANT ?? "demo-agency";
const userId = process.env.PYMES_API_BOOTSTRAP_USER ?? "demo-owner";

if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("INVALID_PYMES_API_PORT");
if (!token || token.length < 16) {
  throw new Error("PYMES_API_BOOTSTRAP_TOKEN_REQUIRED");
}

const repository = new SqliteWorkspaceRepository(process.env.PYMES_API_DB_PATH ?? "./data/pymes-workspace.db");
repository.provisionSession(token, { userId, tenantId, role: "owner" });
const ingressToken = process.env.PYMES_OPENCLAW_INGRESS_TOKEN;
const csv = (value: string | undefined) => new Set((value ?? "").split(",").map(item => item.trim()).filter(Boolean));
const api = new WorkspaceApi(repository, ingressToken ? { token: ingressToken, policy: {
  tenantId,
  allowedAgentIds: csv(process.env.PYMES_OPENCLAW_AGENT_IDS),
  allowedResourceIds: csv(process.env.PYMES_OPENCLAW_RESOURCE_IDS),
  allowedChannels: csv(process.env.PYMES_OPENCLAW_CHANNELS) as Set<"whatsapp" | "telegram" | "imessage" | "email">,
  pairedSenderIds: csv(process.env.PYMES_OPENCLAW_PAIRED_SENDERS),
  consentedConversationIds: csv(process.env.PYMES_OPENCLAW_CONSENTED_CONVERSATIONS)
} } : undefined);
const server = createServer(async (request, nodeResponse) => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let bodyTooLarge = false;
  request.on("data", chunk => {
    bytes += chunk.length;
    if (bytes <= 1_048_576) chunks.push(chunk);
    else bodyTooLarge = true;
  });
  request.on("end", async () => {
    if (bodyTooLarge || bytes > 1_048_576) {
      const requestId = request.headers["x-request-id"] ?? crypto.randomUUID();
      nodeResponse.statusCode = 413;
      nodeResponse.setHeader("content-type", "application/json; charset=utf-8");
      nodeResponse.setHeader("cache-control", "no-store");
      nodeResponse.setHeader("x-content-type-options", "nosniff");
      nodeResponse.setHeader("x-frame-options", "DENY");
      nodeResponse.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
      nodeResponse.setHeader("cross-origin-resource-policy", "same-origin");
      nodeResponse.setHeader("cross-origin-opener-policy", "same-origin");
      nodeResponse.setHeader("x-request-id", Array.isArray(requestId) ? requestId[0] : requestId);
      nodeResponse.end(JSON.stringify({ error: "BODY_TOO_LARGE" }));
      return;
    }
    const url = `http://${request.headers.host ?? `${host}:${port}`}${request.url ?? "/"}`;
    const body = Buffer.concat(chunks);
    try {
      const webRequest = new Request(url, { method: request.method ?? "GET",
        headers: Object.entries(request.headers).flatMap(([key, value]) =>
          value === undefined ? [] : [[key, Array.isArray(value) ? value.join(",") : value] as [string, string]]),
        body: request.method === "POST" ? body : undefined });
      const webResponse = await handlePymesRequest(api, webRequest);
      nodeResponse.statusCode = webResponse.status;
      webResponse.headers.forEach((value, key) => nodeResponse.setHeader(key, value));
      nodeResponse.end(Buffer.from(await webResponse.arrayBuffer()));
    } catch (error) {
      const requestId = request.headers["x-request-id"] ?? crypto.randomUUID();
      nodeResponse.statusCode = 500;
      nodeResponse.setHeader("content-type", "application/json; charset=utf-8");
      nodeResponse.setHeader("cache-control", "no-store");
      nodeResponse.setHeader("x-content-type-options", "nosniff");
      nodeResponse.setHeader("x-frame-options", "DENY");
      nodeResponse.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
      nodeResponse.setHeader("cross-origin-resource-policy", "same-origin");
      nodeResponse.setHeader("cross-origin-opener-policy", "same-origin");
      nodeResponse.setHeader("x-request-id", Array.isArray(requestId) ? requestId[0] : requestId);
      nodeResponse.end(JSON.stringify({ error: "INTERNAL_SERVER_ERROR" }));
      console.error("PYMES request failed", error);
    }
  });
});
// Boundaries for production clients and reverse proxies.
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;
server.listen(port, host, () => console.log(`PYMES API listening on http://${host}:${port}`));

function shutdown(signal: string): void {
  console.log(`PYMES API received ${signal}; shutting down`);
  server.close(error => {
    repository.close();
    if (error) { console.error(error); process.exitCode = 1; }
  });
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
