import assert from "node:assert/strict";
import test from "node:test";
import { handlePymesRequest } from "../src/api-server.js";
import { WorkspaceApi } from "../src/workspace-api.js";

function api() {
  const value = new WorkspaceApi();
  value.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  return value;
}

test("health endpoint is public and reports service identity", async () => {
  const response = await handlePymesRequest(api(), new Request("http://localhost/healthz"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "pymes-workspace", version: "0.1.0" });
});

test("HTTP adapter preserves or creates request correlation ids", async () => {
  const provided = await handlePymesRequest(api(), new Request("http://localhost/healthz", { headers: { "x-request-id": "support-case-42" } }));
  assert.equal(provided.headers.get("x-request-id"), "support-case-42");
  const generated = await handlePymesRequest(api(), new Request("http://localhost/healthz"));
  assert.match(generated.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
});

test("HTTP adapter supports restricted local CORS preflight", async () => {
  const response = await handlePymesRequest(api(), new Request("http://localhost/healthz", {
    method: "OPTIONS", headers: { origin: "http://127.0.0.1:5174" }
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:5174");
  assert.equal(response.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
});

test("HTTP adapter returns JSON and enforces authentication", async () => {
  const response = await handlePymesRequest(api(), new Request("http://localhost/v1/workspaces/agency-1/inbox"));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(await response.json(), { error: "UNAUTHENTICATED" });
});

test("HTTP adapter accepts an approval JSON document", async () => {
  const response = await handlePymesRequest(api(), new Request("http://localhost/v1/workspaces/agency-1/approvals", {
    method: "POST", headers: { authorization: "Bearer owner-token-123456", "content-type": "application/json" },
    body: JSON.stringify({ resourceId: "offer-1", reason: "Revisada por el responsable",
      draftHash: "sha256:v1", approvedAt: "2026-09-29T12:00:00Z" })
  }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).tenantId, "agency-1");
});

test("HTTP adapter rejects invalid JSON and unsupported methods", async () => {
  const invalid = await handlePymesRequest(api(), new Request("http://localhost/v1/workspaces/agency-1/approvals", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{" }));
  assert.equal(invalid.status, 400);
  const method = await handlePymesRequest(api(), new Request("http://localhost/v1/workspaces/agency-1/inbox", { method: "PUT" }));
  assert.equal(method.status, 405);
});
