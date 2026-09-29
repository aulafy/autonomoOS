import { WorkspaceApi, type WorkspaceApiRequest } from "./workspace-api.js";

const MAX_BODY_BYTES = 1_048_576;

function response(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json; charset=utf-8" }
  });
}

/** Web-standard HTTP adapter; usable by Node, tests, or a future edge runtime. */
export async function handlePymesRequest(api: WorkspaceApi, request: Request): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (request.method === "GET" && pathname === "/healthz") {
    return response(200, { status: "ok", service: "pymes-workspace", version: "0.1.0" });
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return response(405, { error: "METHOD_NOT_ALLOWED" });
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    return response(413, { error: "BODY_TOO_LARGE" });
  }
  let body: unknown;
  if (request.method === "POST") {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
      return response(413, { error: "BODY_TOO_LARGE" });
    }
    try { body = text ? JSON.parse(text) : undefined; }
    catch { return response(400, { error: "INVALID_JSON" }); }
  }
  const input: WorkspaceApiRequest = { method: request.method, path: pathname,
    authorization: request.headers.get("authorization") ?? undefined,
    ingressToken: request.headers.get("x-pymes-ingress-token") ?? undefined, body };
  const result = api.handle(input);
  return response(result.status, result.body);
}
