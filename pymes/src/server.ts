import { createServer } from "node:http";
import { WorkspaceApi } from "./workspace-api.js";
import { handlePymesRequest } from "./api-server.js";
import { SqliteWorkspaceRepository } from "./workspace-store-sqlite.js";
import { normalizeRequestId } from "./request-id.js";
import { normalizeBootstrapToken, normalizeOptionalToken, parseConfiguredChannels, parseConfiguredIdSet, parseCorsOrigins } from "./config.js";

const port = Number(process.env.PYMES_API_PORT ?? 8790);
const host = process.env.PYMES_API_HOST ?? "127.0.0.1";
const token = normalizeBootstrapToken(process.env.PYMES_API_BOOTSTRAP_TOKEN);
const tenantId = (process.env.PYMES_API_BOOTSTRAP_TENANT ?? "demo-agency").trim();
const userId = (process.env.PYMES_API_BOOTSTRAP_USER ?? "demo-owner").trim();
const corsOrigins = parseCorsOrigins(process.env.PYMES_API_CORS_ORIGINS);

if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("INVALID_PYMES_API_PORT");
if (!tenantId || !userId) throw new Error("INVALID_PYMES_API_BOOTSTRAP_IDENTITY");
const repository = new SqliteWorkspaceRepository(process.env.PYMES_API_DB_PATH ?? "./data/pymes-workspace.db");
repository.provisionSession(token, { userId, tenantId, role: "owner" });
const ingressToken = normalizeOptionalToken(process.env.PYMES_OPENCLAW_INGRESS_TOKEN, "INVALID_PYMES_OPENCLAW_INGRESS_TOKEN");
const api = new WorkspaceApi(repository, ingressToken ? { token: ingressToken, policy: {
  tenantId,
  allowedAgentIds: parseConfiguredIdSet(process.env.PYMES_OPENCLAW_AGENT_IDS),
  allowedResourceIds: parseConfiguredIdSet(process.env.PYMES_OPENCLAW_RESOURCE_IDS),
  allowedChannels: parseConfiguredChannels(process.env.PYMES_OPENCLAW_CHANNELS),
  pairedSenderIds: parseConfiguredIdSet(process.env.PYMES_OPENCLAW_PAIRED_SENDERS),
  consentedConversationIds: parseConfiguredIdSet(process.env.PYMES_OPENCLAW_CONSENTED_CONVERSATIONS)
} } : undefined);
const server = createServer(async (request, nodeResponse) => {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let bodyTooLarge = false;
  let requestAborted = false;
  request.on("aborted", () => {
    requestAborted = true;
    chunks.length = 0;
  });
  request.on("data", chunk => {
    bytes += chunk.length;
    if (bytes <= 1_048_576) chunks.push(chunk);
    else bodyTooLarge = true;
  });
  request.on("end", async () => {
    if (requestAborted || nodeResponse.writableEnded) return;
    if (bodyTooLarge || bytes > 1_048_576) {
      const requestId = normalizeRequestId(typeof request.headers["x-request-id"] === "string" ? request.headers["x-request-id"] : undefined);
      nodeResponse.statusCode = 413;
      nodeResponse.setHeader("connection", "close");
      nodeResponse.setHeader("content-type", "application/json; charset=utf-8");
      nodeResponse.setHeader("cache-control", "no-store");
      nodeResponse.setHeader("x-content-type-options", "nosniff");
      nodeResponse.setHeader("x-frame-options", "DENY");
      nodeResponse.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
      nodeResponse.setHeader("cross-origin-resource-policy", "same-origin");
      nodeResponse.setHeader("cross-origin-opener-policy", "same-origin");
      nodeResponse.setHeader("x-request-id", requestId);
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
      const webResponse = await handlePymesRequest(api, webRequest, { allowedOrigins: corsOrigins });
      nodeResponse.statusCode = webResponse.status;
      webResponse.headers.forEach((value, key) => nodeResponse.setHeader(key, value));
      nodeResponse.end(Buffer.from(await webResponse.arrayBuffer()));
    } catch (error) {
      const requestId = normalizeRequestId(typeof request.headers["x-request-id"] === "string" ? request.headers["x-request-id"] : undefined);
      nodeResponse.statusCode = 500;
      nodeResponse.setHeader("content-type", "application/json; charset=utf-8");
      nodeResponse.setHeader("cache-control", "no-store");
      nodeResponse.setHeader("x-content-type-options", "nosniff");
      nodeResponse.setHeader("x-frame-options", "DENY");
      nodeResponse.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
      nodeResponse.setHeader("cross-origin-resource-policy", "same-origin");
      nodeResponse.setHeader("cross-origin-opener-policy", "same-origin");
      nodeResponse.setHeader("x-request-id", requestId);
      nodeResponse.end(JSON.stringify({ error: "INTERNAL_SERVER_ERROR" }));
      console.error("PYMES request failed", { requestId, error });
    }
  });
});
server.on("clientError", (error, socket) => {
  if (!socket.writable) return;
  const status = (error as Error & { code?: string }).code === "HPE_HEADER_OVERFLOW"
    ? "431 Request Header Fields Too Large" : "400 Bad Request";
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
});
// Boundaries for production clients and reverse proxies.
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;
server.maxRequestsPerSocket = 1_000;
server.listen(port, host, () => console.log(`PYMES API listening on http://${host}:${port}`));

function shutdown(signal: string): void {
  console.log(`PYMES API received ${signal}; shutting down`);
  const forceExit = setTimeout(() => {
    console.error("PYMES API shutdown timed out");
    repository.close();
    process.exit(1);
  }, 25_000);
  forceExit.unref();
  server.close(error => {
    clearTimeout(forceExit);
    repository.close();
    if (error) { console.error(error); process.exitCode = 1; }
  });
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
