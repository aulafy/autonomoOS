import {openLocalGmail} from "./gmail-local-connector.js";
import {createP01ResponseLoss,loadP01Arm} from "./gmail-fault-injection.js";
import {resolve} from "node:path";
import { openWorkspaceRuntime } from "./runtime-source.js";
import { createServer } from "node:http";
import { WorkspaceApi } from "./workspace-api.js";
import { handlePymesRequest } from "./api-server.js";
import { SqliteWorkspaceRepository } from "./workspace-store-sqlite.js";
import { normalizeRequestId } from "./request-id.js";
import { normalizeBootstrapIdentity, normalizeBootstrapToken, normalizeOptionalToken, parseBoundedOptionalNumber, parseConfiguredChannels, parseConfiguredIdSet, parseCorsOrigins, parseOptionalProviderGateway } from "./config.js";
import { ingestOpenClawIntoWorkspace } from "./workspace-ingress.js";

const port = Number(process.env.PYMES_API_PORT ?? 8790);
const host = (process.env.PYMES_API_HOST ?? "127.0.0.1").trim();
const token = normalizeBootstrapToken(process.env.PYMES_API_BOOTSTRAP_TOKEN);
const tenantId = normalizeBootstrapIdentity(process.env.PYMES_API_BOOTSTRAP_TENANT, "demo-agency");
const userId = normalizeBootstrapIdentity(process.env.PYMES_API_BOOTSTRAP_USER, "demo-owner");
const workerToken = normalizeOptionalToken(process.env.PYMES_API_WORKER_TOKEN, "INVALID_PYMES_API_WORKER_TOKEN");
const workerId = normalizeBootstrapIdentity(process.env.PYMES_API_WORKER_ID, "effects-worker");
const corsOrigins = parseCorsOrigins(process.env.PYMES_API_CORS_ORIGINS);
// Validate optional worker gateway configuration at startup; workers consume the values separately.
parseOptionalProviderGateway(process.env.PYMES_MESSAGE_GATEWAY_URL, process.env.PYMES_MESSAGE_GATEWAY_TOKEN, "INVALID_PYMES_MESSAGE_GATEWAY");
parseOptionalProviderGateway(process.env.PYMES_CRM_GATEWAY_URL, process.env.PYMES_CRM_GATEWAY_TOKEN, "INVALID_PYMES_CRM_GATEWAY");
parseOptionalProviderGateway(process.env.PYMES_CALL_GATEWAY_URL, process.env.PYMES_CALL_GATEWAY_TOKEN, "INVALID_PYMES_CALL_GATEWAY");

if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("INVALID_PYMES_API_PORT");
if (!host || host.length > 255 || /[\u0000-\u001f\u007f]/.test(host)) throw new Error("INVALID_PYMES_API_HOST");
const repository = new SqliteWorkspaceRepository(process.env.PYMES_API_DB_PATH ?? "./data/pymes-workspace.db");
repository.provisionSession(token, { userId, tenantId, role: "owner" });
if (workerToken) repository.provisionSession(workerToken, { userId: workerId, tenantId, role: "worker" });
const ingressToken = normalizeOptionalToken(process.env.PYMES_OPENCLAW_INGRESS_TOKEN, "INVALID_PYMES_OPENCLAW_INGRESS_TOKEN");
const ingressSigningSecret = normalizeOptionalToken(process.env.PYMES_OPENCLAW_SIGNING_SECRET, "INVALID_PYMES_OPENCLAW_SIGNING_SECRET");
const whatsappVerifyToken = process.env.PYMES_WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() ?? "";
const whatsappAppSecret = process.env.PYMES_WHATSAPP_APP_SECRET?.trim() ?? "";
if ((whatsappVerifyToken && !whatsappAppSecret) || (!whatsappVerifyToken && whatsappAppSecret)) throw new Error("INCOMPLETE_WHATSAPP_WEBHOOK_CONFIG");
if (whatsappVerifyToken && (whatsappVerifyToken.length < 16 || whatsappVerifyToken.length > 256 || /[\u0000-\u001f\u007f]/.test(whatsappVerifyToken))) throw new Error("INVALID_WHATSAPP_WEBHOOK_VERIFY_TOKEN");
if (whatsappAppSecret && (whatsappAppSecret.length < 16 || whatsappAppSecret.length > 256 || /[\u0000-\u001f\u007f]/.test(whatsappAppSecret))) throw new Error("INVALID_WHATSAPP_APP_SECRET");
const enterprisePolicy = {
  tenantId,
  allowedAgentIds: parseConfiguredIdSet(process.env.PYMES_OPENCLAW_AGENT_IDS),
  allowedResourceIds: parseConfiguredIdSet(process.env.PYMES_OPENCLAW_RESOURCE_IDS),
  allowedChannels: parseConfiguredChannels(process.env.PYMES_OPENCLAW_CHANNELS),
  pairedSenderIds: parseConfiguredIdSet(process.env.PYMES_OPENCLAW_PAIRED_SENDERS),
  consentedConversationIds: parseConfiguredIdSet(process.env.PYMES_OPENCLAW_CONSENTED_CONVERSATIONS),
  maxEventAgeMs: parseBoundedOptionalNumber(process.env.PYMES_OPENCLAW_MAX_EVENT_AGE_MS, 30 * 24 * 60 * 60 * 1000, "INVALID_PYMES_OPENCLAW_MAX_EVENT_AGE_MS"),
  maxFutureSkewMs: parseBoundedOptionalNumber(process.env.PYMES_OPENCLAW_MAX_FUTURE_SKEW_MS, 24 * 60 * 60 * 1000, "INVALID_PYMES_OPENCLAW_MAX_FUTURE_SKEW_MS"),
  signingSecret: ingressSigningSecret
};
const runtimePath=process.env.PYMES_RUNTIME_DB_PATH??"./data/pymes-task-runtime.db";
const gmailEnabled=process.env.PYMES_GMAIL_ENABLED==='1';
if(gmailEnabled&&(host!=='127.0.0.1'||process.env.PYMES_FAKE_EMAIL_ENABLED==='1'))throw new Error('GMAIL_LOCAL_EXCLUSIVE_PROVIDER_REQUIRED');
// P01 pilot-only: response-loss injection for M3 test C. Off unless an arm file is given.
const p01ArmPath=process.env.PYMES_P01_FAULT_ARM_FILE?.trim();
if(p01ArmPath&&!gmailEnabled)throw new Error('P01_REQUIRES_GMAIL_PILOT');
const p01=p01ArmPath?createP01ResponseLoss(fetch,resolve(p01ArmPath),loadP01Arm(resolve(p01ArmPath),{tenant:tenantId,owner:userId}),(event,meta)=>console.warn('P01',event,meta)):undefined;
if(p01)console.warn('P01 fault-injection configured',{armed:p01.armed()});
const gmail=gmailEnabled?await openLocalGmail(userId,tenantId,runtimePath+'.gmail-attempts.db',resolve(process.env.PYMES_GMAIL_KEYCHAIN_HELPER??'./data/bin/gmail-keychain'),process.env.PYMES_GMAIL_DESKTOP_CLIENT_PATH,p01?.fetcher??fetch):undefined;
const runtime = await openWorkspaceRuntime(runtimePath, tenantId,{fakeEmail:process.env.PYMES_FAKE_EMAIL_ENABLED==='1',gmail});
const api = new WorkspaceApi(repository, ingressToken ? { token: ingressToken, policy: enterprisePolicy } : undefined, runtime.source);
const whatsappWebhook = whatsappVerifyToken && whatsappAppSecret
  ? { verifyToken: whatsappVerifyToken, appSecret: whatsappAppSecret,
      tenantId, agentId: process.env.PYMES_OPENCLAW_AGENT_ID ?? "whatsapp-agent", resourceId: process.env.PYMES_OPENCLAW_RESOURCE_ID ?? "whatsapp-business",
      pairedSenderIds: enterprisePolicy.pairedSenderIds, consentedConversationIds: enterprisePolicy.consentedConversationIds,
      ingest: (envelope: import("./openclaw-gateway.js").OpenClawEnterpriseEnvelope) => {
        if (!ingressToken) throw new Error("WHATSAPP_INGRESS_DISABLED");
        const result = ingestOpenClawIntoWorkspace({ envelope, policy: enterprisePolicy, repository });
        if (!result.accepted && result.reason !== "DUPLICATE_EVENT") throw new Error(result.reason);
      } } : undefined;
let repositoryClosed = false;
function closeRepository(): void {
  if (repositoryClosed) return;
  repositoryClosed = true;
  runtime.close();
  gmail?.close();
  repository.close();
}
function safeError(error: unknown): { name: string; message: string } {
  const value = error instanceof Error ? error : new Error(String(error));
  return { name: value.name.slice(0, 80), message: value.message.slice(0, 500) };
}
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
      nodeResponse.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
      nodeResponse.setHeader("x-dns-prefetch-control", "off");
      nodeResponse.setHeader("x-permitted-cross-domain-policies", "none");
      nodeResponse.setHeader("x-request-id", requestId);
      nodeResponse.end(JSON.stringify({ error: "BODY_TOO_LARGE" }));
      return;
    }
    const url = `http://${host}:${port}${request.url ?? "/"}`;
    const body = Buffer.concat(chunks);
    try {
      const webRequest = new Request(url, { method: request.method ?? "GET",
        headers: Object.entries(request.headers).flatMap(([key, value]) =>
          value === undefined ? [] : [[key, Array.isArray(value) ? value.join(",") : value] as [string, string]]),
        body: request.method === "POST" ? body : undefined });
      const webResponse = await handlePymesRequest(api, webRequest, { allowedOrigins: corsOrigins, whatsappWebhook });
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
      nodeResponse.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
      nodeResponse.setHeader("x-dns-prefetch-control", "off");
      nodeResponse.setHeader("x-permitted-cross-domain-policies", "none");
      nodeResponse.setHeader("x-request-id", requestId);
      nodeResponse.end(JSON.stringify({ error: "INTERNAL_SERVER_ERROR" }));
      console.error("PYMES request failed", { requestId, error: safeError(error) });
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
server.on("error", error => {
  console.error("PYMES API listen failed", { error: safeError(error) });
  closeRepository();
  process.exitCode = 1;
});
server.listen(port, host, () => console.log(`PYMES API listening on http://${host}:${port}`));

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`PYMES API received ${signal}; shutting down`);
  const forceExit = setTimeout(() => {
    console.error("PYMES API shutdown timed out");
    closeRepository();
    process.exit(1);
  }, 25_000);
  forceExit.unref();
  server.close(error => {
    clearTimeout(forceExit);
    closeRepository();
    if (error) { console.error(error); process.exitCode = 1; }
  });
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
