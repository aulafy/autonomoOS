import { WorkspaceApi, type WorkspaceApiRequest } from "./workspace-api.js";

const MAX_BODY_BYTES = 1_048_576;

const newRequestId = (): string => crypto.randomUUID();
function response(status: number, body: Record<string, unknown>, requestId = newRequestId(), origin?: string): Response {
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", "x-request-id": requestId,
    "cache-control": "no-store", "vary": "Origin", "x-content-type-options": "nosniff", "x-frame-options": "DENY",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "cross-origin-resource-policy": "same-origin", "referrer-policy": "no-referrer" };
  if (origin && ["http://127.0.0.1:5174", "http://localhost:5174"].includes(origin)) {
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
export async function handlePymesRequest(api: WorkspaceApi, request: Request): Promise<Response> {
  const suppliedRequestId = request.headers.get("x-request-id")?.trim();
  const requestId = suppliedRequestId && suppliedRequestId.length <= 200 ? suppliedRequestId : newRequestId();
  const pathname = new URL(request.url).pathname;
  const origin = request.headers.get("origin") ?? undefined;
  if (request.method === "OPTIONS") return response(200, { status: "ok" }, requestId, origin);
  if (request.method === "GET" && pathname === "/healthz") {
    return response(200, { status: "ok", service: "pymes-workspace", version: "0.1.0" }, requestId, origin);
  }
  if (request.method === "GET" && pathname === "/readyz") {
    const ready = api.isReady();
    const result = response(ready ? 200 : 503, { status: ready ? "ok" : "not_ready", service: "pymes-workspace", version: "0.1.0" }, requestId, origin);
    if (!ready) result.headers.set("retry-after", "5");
    return result;
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return response(405, { error: "METHOD_NOT_ALLOWED" }, requestId, origin);
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    return response(413, { error: "BODY_TOO_LARGE" }, requestId, origin);
  }
  let body: unknown;
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") return response(415, { error: "UNSUPPORTED_MEDIA_TYPE" }, requestId, origin);
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return response(413, { error: "BODY_TOO_LARGE" }, requestId, origin);
    }
    try { body = text ? JSON.parse(text) : undefined; }
    catch { return response(400, { error: "INVALID_JSON" }, requestId, origin); }
  }
  const input: WorkspaceApiRequest = { method: request.method, path: pathname,
    authorization: request.headers.get("authorization") ?? undefined,
    ingressToken: request.headers.get("x-pymes-ingress-token") ?? undefined, body };
  const result = api.handle(input);
  return response(result.status, result.body, requestId, origin);
}
