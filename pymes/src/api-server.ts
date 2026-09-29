import { WorkspaceApi, type WorkspaceApiRequest } from "./workspace-api.js";
import { normalizeRequestId } from "./request-id.js";

const MAX_BODY_BYTES = 1_048_576;
const defaultCorsOrigins = ["http://127.0.0.1:5174", "http://localhost:5174"];
export interface PymesHttpOptions { allowedOrigins?: readonly string[]; serviceVersion?: string; }
const defaultServiceVersion = process.env.PYMES_API_VERSION ?? "0.1.0";

function response(status: number, body: Record<string, unknown>, requestId = normalizeRequestId(undefined), origin?: string, allowedOrigins: readonly string[] = defaultCorsOrigins): Response {
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", "x-request-id": requestId,
    "cache-control": "no-store", "vary": "Origin", "x-content-type-options": "nosniff", "x-frame-options": "DENY",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "cross-origin-resource-policy": "same-origin", "cross-origin-opener-policy": "same-origin",
    "referrer-policy": "no-referrer" };
  if (origin && allowedOrigins.includes(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-headers"] = "Authorization, Content-Type, X-PYMES-Ingress-Token, X-Request-Id";
    headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
    headers["access-control-expose-headers"] = "x-request-id, retry-after";
    headers["access-control-max-age"] = "600";
  }
  return new Response(JSON.stringify(body), {
    status, headers
  });
}

/** Web-standard HTTP adapter; usable by Node, tests, or a future edge runtime. */
export async function handlePymesRequest(api: WorkspaceApi, request: Request, options: PymesHttpOptions = {}): Promise<Response> {
  const allowedOrigins = options.allowedOrigins ?? defaultCorsOrigins;
  const serviceVersion = options.serviceVersion ?? defaultServiceVersion;
  const requestId = normalizeRequestId(request.headers.get("x-request-id")?.trim());
  const pathname = new URL(request.url).pathname;
  const origin = request.headers.get("origin") ?? undefined;
  if (request.method === "OPTIONS") return response(200, { status: "ok" }, requestId, origin, allowedOrigins);
  if (request.method === "GET" && pathname === "/healthz") {
    return response(200, { status: "ok", service: "pymes-workspace", version: serviceVersion }, requestId, origin, allowedOrigins);
  }
  if (request.method === "GET" && pathname === "/readyz") {
    const ready = api.isReady();
    const result = response(ready ? 200 : 503, { status: ready ? "ok" : "not_ready", service: "pymes-workspace", version: serviceVersion }, requestId, origin, allowedOrigins);
    if (!ready) result.headers.set("retry-after", "5");
    return result;
  }
  if (request.method !== "GET" && request.method !== "POST") {
    const result = response(405, { error: "METHOD_NOT_ALLOWED" }, requestId, origin, allowedOrigins);
    result.headers.set("allow", "GET, POST, OPTIONS");
    return result;
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    return response(413, { error: "BODY_TOO_LARGE" }, requestId, origin, allowedOrigins);
  }
  let body: unknown;
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") return response(415, { error: "UNSUPPORTED_MEDIA_TYPE" }, requestId, origin, allowedOrigins);
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return response(413, { error: "BODY_TOO_LARGE" }, requestId, origin, allowedOrigins);
    }
    try { body = text ? JSON.parse(text) : undefined; }
    catch { return response(400, { error: "INVALID_JSON" }, requestId, origin, allowedOrigins); }
  }
  const input: WorkspaceApiRequest = { method: request.method, path: pathname,
    authorization: request.headers.get("authorization") ?? undefined,
    ingressToken: request.headers.get("x-pymes-ingress-token") ?? undefined, body };
  const result = api.handle(input);
  return response(result.status, result.body, requestId, origin, allowedOrigins);
}
