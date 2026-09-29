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

test("readiness endpoint is public", async () => {
  const response = await handlePymesRequest(api(), new Request("http://localhost/readyz"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "ok");
});

test("readiness reports storage failures", async () => {
  const broken = new WorkspaceApi({
    findSession() { return null; }, listInbox() { throw new Error("DB_DOWN"); },
    appendInbox() {}, updateInbox() {}, appendApproval() {}, listApprovals() { return []; },
    appendCaseAudit() {}, listCaseAudit() { return []; }, appendEffect() {}, updateEffect() {}, listEffects() { return []; }
  });
  const response = await handlePymesRequest(broken, new Request("http://localhost/readyz"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).status, "not_ready");
});

test("HTTP adapter preserves or creates request correlation ids", async () => {
  const provided = await handlePymesRequest(api(), new Request("http://localhost/healthz", { headers: { "x-request-id": "support-case-42" } }));
  assert.equal(provided.headers.get("x-request-id"), "support-case-42");
  const generated = await handlePymesRequest(api(), new Request("http://localhost/healthz"));
  assert.match(generated.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
  const oversized = await handlePymesRequest(api(), new Request("http://localhost/healthz", { headers: { "x-request-id": "x".repeat(201) } }));
  assert.match(oversized.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
});

test("HTTP adapter supports restricted local CORS preflight", async () => {
  const response = await handlePymesRequest(api(), new Request("http://localhost/healthz", {
    method: "OPTIONS", headers: { origin: "http://127.0.0.1:5174" }
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:5174");
  assert.equal(response.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  const denied = await handlePymesRequest(api(), new Request("http://localhost/healthz", {
    method: "OPTIONS", headers: { origin: "https://attacker.example" }
  }));
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("HTTP adapter returns JSON and enforces authentication", async () => {
  const response = await handlePymesRequest(api(), new Request("http://localhost/v1/workspaces/agency-1/inbox"));
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
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
