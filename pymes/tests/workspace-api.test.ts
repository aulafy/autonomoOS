import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceApi } from "../src/workspace-api.js";

function api() {
  const value = new WorkspaceApi();
  value.addSession("reviewer-token-1234", { userId: "u-reviewer", tenantId: "agency-1", role: "reviewer" });
  value.addSession("agent-token-12345", { userId: "u-agent", tenantId: "agency-1", role: "agent" });
  value.addSession("owner-token-12345", { userId: "u-owner", tenantId: "agency-1", role: "owner" });
  value.addSession("other-token-1234", { userId: "u-other", tenantId: "agency-2", role: "reviewer" });
  value.addInbox({ id: "msg-1", tenantId: "agency-1", state: "pending_review", summary: "Propuesta de hogar" });
  value.addInbox({ id: "msg-2", tenantId: "agency-2", state: "received", summary: "Privado" });
  return value;
}

test("API authenticates and isolates inbox by tenant", () => {
  const value = api();
  value.addInbox({ id: "msg-1", tenantId: "agency-1", state: "approved", summary: "Actualizado" });
  assert.equal(value.handle({ method: "GET", path: "/v1/workspaces/agency-1/inbox" }).status, 401);
  const own = value.handle({ method: "GET", path: "/v1/workspaces/agency-1/inbox",
    authorization: "Bearer reviewer-token-1234" });
  assert.equal(own.status, 200);
  assert.deepEqual((own.body.items as Array<{ id: string; state: string }>).map(item => `${item.id}:${item.state}`), ["msg-1:approved"]);
  assert.equal(value.handle({ method: "GET", path: "/v1/workspaces/agency-2/inbox",
    authorization: "Bearer reviewer-token-1234" }).status, 403);
});

test("connector registry is authenticated and tenant scoped", () => {
  const value = api();
  const own = value.handle({ method: "GET", path: "/v1/workspaces/agency-1/connectors",
    authorization: "Bearer reviewer-token-1234" });
  assert.equal(own.status, 200);
  assert.deepEqual((own.body.connectors as Array<{ id: string }>).map(connector => connector.id), ["holded", "google_calendar"]);
  assert.equal(value.handle({ method: "GET", path: "/v1/workspaces/agency-2/connectors",
    authorization: "Bearer reviewer-token-1234" }).status, 403);
});

test("agent cannot approve; reviewer approval is recorded", () => {
  const value = api();
  const body = { resourceId: "offer-1", reason: "Revisada con el documento original",
    draftHash: "sha256:offer-v1", approvedAt: "2026-09-29T11:00:00Z" };
  assert.equal(value.handle({ method: "POST", path: "/v1/workspaces/agency-1/approvals",
    authorization: "Bearer agent-token-12345", body }).status, 403);
  const response = value.handle({ method: "POST", path: "/v1/workspaces/agency-1/approvals",
    authorization: "Bearer reviewer-token-1234", body });
  assert.equal(response.status, 201);
  assert.equal(value.approvalsForTenant("agency-1").length, 1);
});

test("malformed approval is rejected without creating state", () => {
  const value = api();
  const response = value.handle({ method: "POST", path: "/v1/workspaces/agency-1/approvals",
    authorization: "Bearer reviewer-token-1234", body: { resourceId: "offer-1" } });
  assert.equal(response.status, 400);
  assert.equal(value.approvalsForTenant("agency-1").length, 0);
});

test("reviewer can read approvals but tenant remains isolated", () => {
  const value = api();
  const response = value.handle({ method: "GET", path: "/v1/workspaces/agency-1/approvals",
    authorization: "Bearer reviewer-token-1234" });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.approvals, []);
});

test("metrics expose tenant-scoped operational counts without message content", () => {
  const value = api();
  const denied = value.handle({ method: "GET", path: "/v1/workspaces/agency-1/metrics" });
  assert.equal(denied.status, 401);
  const response = value.handle({ method: "GET", path: "/v1/workspaces/agency-1/metrics",
    authorization: "Bearer reviewer-token-1234" });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.inbox, { total: 1, byState: { pending_review: 1 } });
  assert.deepEqual(response.body.effects, { total: 0, byStatus: {} });
  assert.deepEqual(response.body.approvals, { total: 0 });
  assert.equal("summary" in response.body, false);
  assert.equal(value.handle({ method: "GET", path: "/v1/workspaces/agency-2/metrics",
    authorization: "Bearer reviewer-token-1234" }).status, 403);
  const effect = value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects",
    authorization: "Bearer owner-token-12345", body: { id: "metric-effect", caseId: "msg-1", kind: "call",
      payload: { phone: "+34600000000" }, requestedAt: "2026-09-30T10:00:00Z", draftHash: "sha256:metric" } });
  assert.equal(effect.status, 201);
  const withEffect = value.handle({ method: "GET", path: "/v1/workspaces/agency-1/metrics",
    authorization: "Bearer reviewer-token-1234" });
  assert.deepEqual(withEffect.body.effects, { total: 1, byStatus: { pending: 1 } });
  const confirmed = value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects/metric-effect/confirm",
    authorization: "Bearer owner-token-12345", body: { confirm: true, confirmedAt: "2026-09-30T10:04:00Z" } });
  assert.equal(confirmed.status, 200);
  const failed = value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects/metric-effect/result",
    authorization: "Bearer owner-token-12345", body: { result: "failed", executedAt: "2026-09-30T10:05:00Z", note: "Proveedor no disponible" } });
  assert.equal(failed.status, 200);
  const withFailure = value.handle({ method: "GET", path: "/v1/workspaces/agency-1/metrics",
    authorization: "Bearer reviewer-token-1234" });
  assert.deepEqual(withFailure.body.effects, { total: 1, byStatus: { failed: 1 } });
  assert.deepEqual(withFailure.body.alerts, [{ code: "FAILED_EFFECTS", severity: "critical", count: 1 }]);
});

test("metrics alert on pending cases older than the operational SLA", () => {
  const value = api();
  value.addInbox({ id: "stale-case", tenantId: "agency-1", state: "pending_review", summary: "Consulta antigua",
    updatedAt: "2020-01-01T09:00:00Z" });
  const response = value.handle({ method: "GET", path: "/v1/workspaces/agency-1/metrics",
    authorization: "Bearer reviewer-token-1234" });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.alerts, [{ code: "STALE_CASES", severity: "warning", count: 1 }]);
});

test("case transition is authenticated and leaves an audit trail", () => {
  const value = api();
  const response = value.handle({ method: "POST", path: "/v1/workspaces/agency-1/cases/msg-1/transition",
    authorization: "Bearer agent-token-12345", body: { to: "approved", at: "2026-09-29T12:00:00Z" } });
  assert.equal(response.status, 403);
  const allowed = value.handle({ method: "POST", path: "/v1/workspaces/agency-1/cases/msg-1/transition",
    authorization: "Bearer reviewer-token-1234", body: { to: "approved", at: "2026-09-29T12:00:00Z" } });
  assert.equal(allowed.status, 200);
  const stale = value.handle({ method: "POST", path: "/v1/workspaces/agency-1/cases/msg-1/transition",
    authorization: "Bearer reviewer-token-1234", body: { to: "executing", at: "2026-09-29T12:01:00Z", expectedVersion: 0 } });
  assert.equal(stale.status, 409);
  assert.equal((stale.body as { error: string }).error, "CASE_VERSION_CONFLICT");
  const audit = value.handle({ method: "GET", path: "/v1/workspaces/agency-1/cases/msg-1/audit",
    authorization: "Bearer reviewer-token-1234" });
  assert.equal((audit.body.audit as Array<unknown>).length, 1);
});

test("effects require execute permission and explicit confirmation", () => {
  const value = api();
  const draft = { id: "effect-1", caseId: "msg-1", kind: "call", payload: { phone: "+34600000000" },
    requestedAt: "2026-09-29T12:00:00Z", draftHash: "sha256:effect" };
  assert.equal(value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects",
    authorization: "Bearer reviewer-token-1234", body: draft }).status, 403);
  const created = value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects",
    authorization: "Bearer owner-token-12345", body: draft });
  assert.equal(created.status, 201);
  assert.equal(value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects",
    authorization: "Bearer owner-token-12345", body: draft }).status, 400);
  assert.equal(value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects/effect-1/confirm",
    authorization: "Bearer owner-token-12345", body: { confirmedAt: "2026-09-29T12:05:00Z" } }).status, 400);
  const confirmed = value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects/effect-1/confirm",
    authorization: "Bearer owner-token-12345", body: { confirm: true, confirmedAt: "2026-09-29T12:05:00Z" } });
  assert.equal(confirmed.status, 200);
  assert.equal((confirmed.body as { status: string }).status, "confirmed");
  const failed = value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects/effect-1/result",
    authorization: "Bearer owner-token-12345", body: { result: "failed", executedAt: "2026-09-29T12:06:00Z", note: "No se pudo contactar con el cliente" } });
  assert.equal(failed.status, 200);
  assert.equal((failed.body as { status: string }).status, "failed");
  assert.equal(value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects/effect-1/result",
    authorization: "Bearer owner-token-12345", body: { result: "succeeded", executedAt: "2026-09-29T12:07:00Z", note: "Reintento" } }).status, 400);
  const retry = value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects/effect-1/retry",
    authorization: "Bearer owner-token-12345", body: { requestedAt: "2026-09-29T12:20:00Z", reason: "Cliente disponible" } });
  assert.equal(retry.status, 200);
  assert.equal((retry.body as { status: string }).status, "pending");
  assert.equal((retry.body as { retryCount: number }).retryCount, 1);
  assert.match((retry.body as { executionNote: string }).executionNote, /No se pudo contactar.*Cliente disponible/s);
  for (let attempt = 2; attempt <= 20; attempt++) {
    assert.equal(value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects/effect-1/confirm",
      authorization: "Bearer owner-token-12345", body: { confirm: true, confirmedAt: `2026-09-29T12:${String(attempt).padStart(2, "0")}:00Z` } }).status, 200);
    assert.equal(value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects/effect-1/result",
      authorization: "Bearer owner-token-12345", body: { result: "failed", executedAt: `2026-09-29T13:${String(attempt).padStart(2, "0")}:00Z`, note: "Sin respuesta" } }).status, 200);
    assert.equal(value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects/effect-1/retry",
      authorization: "Bearer owner-token-12345", body: { requestedAt: `2026-09-29T14:${String(attempt).padStart(2, "0")}:00Z`, reason: `Reintento ${attempt}` } }).status, 200);
  }
  assert.equal(value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects/effect-1/confirm",
    authorization: "Bearer owner-token-12345", body: { confirm: true, confirmedAt: "2026-09-29T15:00:00Z" } }).status, 200);
  assert.equal(value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects/effect-1/result",
    authorization: "Bearer owner-token-12345", body: { result: "failed", executedAt: "2026-09-29T15:01:00Z", note: "Sin respuesta" } }).status, 200);
  const limit = value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects/effect-1/retry",
    authorization: "Bearer owner-token-12345", body: { requestedAt: "2026-09-29T15:02:00Z", reason: "Límite" } });
  assert.equal(limit.status, 400);
  assert.equal((limit.body as { error: string }).error, "EFFECT_RETRY_LIMIT_REACHED");
  assert.equal(value.handle({ method: "GET", path: "/v1/workspaces/agency-2/effects",
    authorization: "Bearer other-token-1234" }).status, 200);
  assert.deepEqual((value.handle({ method: "GET", path: "/v1/workspaces/agency-2/effects",
    authorization: "Bearer other-token-1234" }).body.effects), []);
  const own = value.handle({ method: "GET", path: "/v1/workspaces/agency-1/effects/effect-1",
    authorization: "Bearer owner-token-12345" });
  assert.equal(own.status, 200);
  assert.equal((own.body as { id: string }).id, "effect-1");
  assert.equal(value.handle({ method: "GET", path: "/v1/workspaces/agency-2/effects/effect-1",
    authorization: "Bearer other-token-1234" }).status, 404);
  assert.equal(value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects",
    authorization: "Bearer owner-token-12345", body: { ...draft, id: "effect-invalid", kind: "webhook" } }).status, 400);
  assert.equal(value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects",
    authorization: "Bearer owner-token-12345", body: { ...draft, id: "effect-large", payload: { data: "x".repeat(70000) } } }).status, 400);
});

test("effect requests leave an auditable case entry", () => {
  const value = api();
  const response = value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects",
    authorization: "Bearer owner-token-12345", body: { id: "audited-effect", caseId: "msg-1", kind: "crm_task",
      payload: { title: "Seguimiento" }, requestedAt: "2026-09-30T10:00:00Z", draftHash: "sha256:audit" } });
  assert.equal(response.status, 201);
  const audit = value.handle({ method: "GET", path: "/v1/workspaces/agency-1/cases/msg-1/audit",
    authorization: "Bearer reviewer-token-1234" });
  assert.deepEqual((audit.body.audit as Array<{ operation: string; actorId: string }>).map(entry => [entry.operation, entry.actorId]), [["effect_requested", "u-owner"]]);
});

test("effects reject control characters in resource identifiers", () => {
  const value = new WorkspaceApi();
  value.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  assert.equal(value.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects", authorization: "Bearer owner-token-123456",
    body: { id: "effect-1\n", caseId: "case-1", kind: "call", payload: { phone: "+34600000000" }, requestedAt: "2026-09-29T14:00:00Z", draftHash: "sha256:test" } }).status, 400);
});
test("session provisioning rejects oversized tokens", () => {
  const api = new WorkspaceApi();
  assert.throws(() => api.addSession("x".repeat(4097), { userId: "owner", tenantId: "agency-1", role: "owner" }), /INVALID_SESSION_TOKEN/);
});

test("authenticated users can revoke their current session", () => {
  const value = api();
  const request = { method: "POST" as const, path: "/v1/workspaces/agency-1/session/revoke", authorization: "Bearer reviewer-token-1234" };
  assert.equal(value.handle(request).status, 200);
  assert.equal(value.handle({ method: "GET", path: "/v1/workspaces/agency-1/inbox", authorization: request.authorization }).status, 401);
});
