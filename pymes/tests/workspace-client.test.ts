import assert from "node:assert/strict";
import test from "node:test";
import { WorkspaceApi } from "../src/workspace-api.js";
import { handlePymesRequest } from "../src/api-server.js";
import { WorkspaceClient, WorkspaceConflictError, WorkspaceHttpError } from "../src/workspace-client.js";

function client() {
  const api = new WorkspaceApi();
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  api.addInbox({ id: "msg-remote", tenantId: "agency-1", state: "pending_review", summary: "Caso remoto" });
  const fetcher: typeof fetch = (input, init) => handlePymesRequest(api,
    new Request(String(input), init));
  return new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1",
    token: "owner-token-123456" }, fetcher);
}

test("workspace client uses the API contract for approvals", async () => {
  const value = client();
  const created = await value.approve({ resourceId: "offer-1", reason: "Revisión completa",
    draftHash: "sha256:v1", approvedAt: "2026-09-29T14:00:00Z" });
  assert.equal(created.resourceId, "offer-1");
  assert.equal((await value.approvals()).length, 1);
  assert.equal((await value.inbox())[0]?.id, "msg-remote");
  assert.deepEqual((await value.connectors()).map(connector => connector.id), ["holded", "google_calendar"]);
});

test("workspace client exposes health and readiness contracts", async () => {
  const value = client();
  assert.equal((await value.health()).service, "pymes-workspace");
  assert.equal((await value.ready()).status, "ok");
});

test("workspace client validates tenant-scoped operational metrics", async () => {
  const metrics = await client().metrics();
  assert.equal(metrics.tenantId, "agency-1");
  assert.deepEqual(metrics.inbox, { total: 1, byState: { pending_review: 1 } });
  assert.deepEqual(metrics.effects, { total: 0, byStatus: {} });
});

test("HTTP metrics route authenticates and preserves tenant isolation", async () => {
  const api = new WorkspaceApi();
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  api.addInbox({ id: "metric-case", tenantId: "agency-1", state: "pending_review", summary: "Caso de prueba" });
  const unauthorized = await handlePymesRequest(api, new Request("http://workspace.local/v1/workspaces/agency-1/metrics"));
  assert.equal(unauthorized.status, 401);
  const authorized = await handlePymesRequest(api, new Request("http://workspace.local/v1/workspaces/agency-1/metrics", {
    headers: { authorization: "Bearer owner-token-123456" }
  }));
  assert.equal(authorized.status, 200);
  const body = await authorized.json() as { tenantId: string; inbox: { total: number } };
  assert.equal(body.tenantId, "agency-1");
  assert.equal(body.inbox.total, 1);
  const other = await handlePymesRequest(api, new Request("http://workspace.local/v1/workspaces/agency-2/metrics", {
    headers: { authorization: "Bearer owner-token-123456" }
  }));
  assert.equal(other.status, 403);
});

test("workspace client exposes not-ready state without throwing", async () => {
  const broken = new WorkspaceApi({
    findSession() { return null; }, listInbox() { throw new Error("DB_DOWN"); }, revokeSession() {},
    appendInbox() {}, updateInbox() {}, appendApproval() {}, listApprovals() { return []; },
    appendCaseAudit() {}, listCaseAudit() { return []; }, appendEffect() {}, updateEffect() {}, listEffects() { return []; }
  });
  const fetcher: typeof fetch = (input, init) => handlePymesRequest(broken, new Request(String(input), init));
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  const readiness = await value.ready();
  assert.equal(readiness.status, "not_ready");
  assert.equal(readiness.retryAfter, "5");
});

test("workspace client preserves HTTP error status and request id", async () => {
  const api = new WorkspaceApi();
  const fetcher: typeof fetch = (input, init) => handlePymesRequest(api, new Request(String(input), init));
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await assert.rejects(() => value.inbox(), (error: unknown) => error instanceof WorkspaceHttpError && error.status === 401 && typeof error.requestId === "string" && error.retryAfter === null);
});

test("workspace client preserves retry-after metadata", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ error: "TEMPORARY" }), {
    status: 503, headers: { "content-type": "application/json", "x-request-id": "retry-42", "retry-after": "5" }
  });
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await assert.rejects(() => value.inbox(), (error: unknown) => error instanceof WorkspaceHttpError && error.status === 503 && error.retryAfter === "5" && error.requestId === "retry-42");
});

test("workspace client rejects malformed connector registry", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ connectors: [{ id: "bad" }] }), {
    status: 200, headers: { "content-type": "application/json" }
  });
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await assert.rejects(() => value.connectors(), /INVALID_WORKSPACE_CONNECTORS/);
});

test("workspace client rejects a connector registry for another tenant", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-2", connectors: [{ id: "holded", name: "Holded", status: "lectura preparada" }] }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => value.connectors(), /INVALID_WORKSPACE_CONNECTORS/);
});

test("workspace client rejects duplicate connector identifiers", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", connectors: [
    { id: "holded", name: "Holded", status: "lectura preparada" },
    { id: "holded", name: "Holded duplicado", status: "lectura preparada" }
  ] }), { status: 200, headers: { "content-type": "application/json" } });
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => value.connectors(), /INVALID_WORKSPACE_CONNECTORS/);
});

test("workspace client rejects inbox records for another tenant", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ items: [
    { id: "case-1", tenantId: "agency-2", state: "pending_review", summary: "Caso ajeno" }
  ] }), { status: 200, headers: { "content-type": "application/json" } });
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => value.inbox(), /INVALID_WORKSPACE_INBOX/);
});

test("workspace client rejects approvals for another tenant", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ approvals: [
    { id: "approval-1", tenantId: "agency-2", resourceId: "offer-1", operation: "approveOffer", approvedBy: "owner", approvedAt: "2026-09-30T10:00:00Z", reason: "Revisada", draftHash: "sha256:v1" }
  ] }), { status: 200, headers: { "content-type": "application/json" } });
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => value.approvals(), /INVALID_WORKSPACE_APPROVALS/);
});

test("workspace client rejects effects for another tenant", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-2", effects: [] }), {
    status: 200, headers: { "content-type": "application/json" }
  });
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => value.effects(), /INVALID_WORKSPACE_EFFECTS/);
});

test("workspace client rejects audit for another tenant or case", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-2", caseId: "case-other", audit: [] }), {
    status: 200, headers: { "content-type": "application/json" }
  });
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => value.audit("case-1"), /INVALID_WORKSPACE_AUDIT/);
});

test("workspace client rejects incomplete individual effects", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ id: "effect-1", status: "pending" }), {
    status: 200, headers: { "content-type": "application/json" }
  });
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => value.effect("effect-1"), /INVALID_WORKSPACE_EFFECT/);
});

test("workspace client rejects malformed effect mutation responses", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ id: "effect-1", status: "confirmed" }), {
    status: 200, headers: { "content-type": "application/json" }
  });
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => value.confirmEffect("effect-1"), /INVALID_WORKSPACE_EFFECT/);
});

test("workspace client rejects malformed approval mutation responses", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", id: "approval-1" }), {
    status: 201, headers: { "content-type": "application/json" }
  });
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => value.approve({ resourceId: "offer-1", reason: "Revisada", draftHash: "sha256:v1", approvedAt: "2026-09-30T10:00:00Z" }), /INVALID_WORKSPACE_APPROVAL/);
});

test("workspace client rejects empty approval input before network access", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls += 1; return new Response("{}", { status: 500 }); };
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => value.approve({ resourceId: "", reason: "", draftHash: "", approvedAt: "" }), /INVALID_WORKSPACE_APPROVAL_INPUT/);
  assert.equal(calls, 0);
});

test("workspace client rejects empty effect commands before network access", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls += 1; return new Response("{}", { status: 500 }); };
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => value.confirmEffect(""), /INVALID_WORKSPACE_EFFECT_INPUT/);
  await assert.rejects(() => value.reportEffectResult("effect-1", "succeeded", ""), /INVALID_WORKSPACE_EFFECT_INPUT/);
  await assert.rejects(() => value.retryEffect("effect-1", ""), /INVALID_WORKSPACE_EFFECT_INPUT/);
  assert.equal(calls, 0);
});

test("workspace client rejects invalid transitions before network access", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls += 1; return new Response("{}", { status: 500 }); };
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => value.transition("", "accepted"), /INVALID_WORKSPACE_TRANSITION_INPUT/);
  await assert.rejects(() => value.transition("case-1", "accepted", undefined, -1), /INVALID_WORKSPACE_TRANSITION_INPUT/);
  assert.equal(calls, 0);
});

test("workspace client rejects empty case and effect identifiers before network access", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls += 1; return new Response("{}", { status: 500 }); };
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => value.audit(""), /INVALID_WORKSPACE_CASE_INPUT/);
  await assert.rejects(() => value.effectsForCase(""), /INVALID_WORKSPACE_CASE_INPUT/);
  await assert.rejects(() => value.effect(""), /INVALID_WORKSPACE_EFFECT_INPUT/);
  assert.equal(calls, 0);
});

test("workspace client rejects unsafe resource identifiers", async () => {
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, async () => new Response("{}"));
  await assert.rejects(() => value.audit("case\n1"), /INVALID_WORKSPACE_CASE_INPUT/);
  await assert.rejects(() => value.effect("e".repeat(201)), /INVALID_WORKSPACE_EFFECT_INPUT/);
});

test("workspace client rejects unsafe mutation text before network access", async () => {
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, async () => new Response("{}"));
  await assert.rejects(() => value.approve({ resourceId: "offer-1", reason: "bad\nreason", draftHash: "sha256:v1", approvedAt: "2026-09-30T10:00:00Z" }), /INVALID_WORKSPACE_APPROVAL_INPUT/);
  await assert.rejects(() => value.reportEffectResult("effect-1", "failed", "n".repeat(2_001)), /INVALID_WORKSPACE_EFFECT_INPUT/);
});

test("workspace client rejects invalid timestamps before network access", async () => {
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, async () => new Response("{}"));
  await assert.rejects(() => value.transition("case-1", "accepted", "tomorrow"), /INVALID_WORKSPACE_TRANSITION_INPUT/);
  await assert.rejects(() => value.confirmEffect("effect-1", "tomorrow"), /INVALID_WORKSPACE_EFFECT_INPUT/);
  await assert.rejects(() => value.retryEffect("effect-1", "Reintento", "tomorrow"), /INVALID_WORKSPACE_EFFECT_INPUT/);
});

test("workspace client rejects unsafe approval resources and transition targets", async () => {
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, async () => new Response("{}"));
  await assert.rejects(() => value.approve({ resourceId: "offer\n1", reason: "Revisada", draftHash: "sha256:v1", approvedAt: "2026-09-30T10:00:00Z" }), /INVALID_WORKSPACE_APPROVAL_INPUT/);
  await assert.rejects(() => value.transition("case-1", "accepted\nnow"), /INVALID_WORKSPACE_TRANSITION_INPUT/);
});

test("workspace client rejects malformed audit entries", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", caseId: "case-1", audit: [
    { id: "audit-1", caseId: "case-other", from: "received", to: "accepted", operation: "transition", actorId: "owner", at: "2026-09-30T10:00:00Z", version: 1 }
  ] }), { status: 200, headers: { "content-type": "application/json" } });
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => value.audit("case-1"), /INVALID_WORKSPACE_AUDIT/);
});

test("workspace client rejects unsafe audit metadata", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", caseId: "case-1", audit: [{ id: "audit-1", caseId: "case-1", from: "received", to: "approved", operation: "transition", actorId: "owner\n", at: "2026-09-30T10:00:00Z", version: 1 }] }), { status: 200, headers: { "content-type": "application/json" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => client.audit("case-1"), /INVALID_WORKSPACE_AUDIT/);
});

test("workspace client rejects malformed audit request ids", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", caseId: "case-1", audit: [{ id: "audit-1", caseId: "case-1", from: "received", to: "approved", operation: "transition", actorId: "owner", at: "2026-09-30T10:00:00Z", version: 1, requestId: "request\n1" }] }), { status: 200, headers: { "content-type": "application/json" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => client.audit("case-1"), /INVALID_WORKSPACE_AUDIT/);
});

test("workspace client rejects audit entries with invalid timestamps", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", caseId: "case-1", audit: [
    { id: "audit-1", caseId: "case-1", from: "received", to: "accepted", operation: "transition", actorId: "owner", at: "soon", version: 1 }
  ] }), { status: 200, headers: { "content-type": "application/json" } });
  const value = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => value.audit("case-1"), /INVALID_WORKSPACE_AUDIT/);
});

test("workspace client rejects approvals and effects with invalid timestamps", async () => {
  const approvals: typeof fetch = async () => new Response(JSON.stringify({ approvals: [{ id: "a", tenantId: "agency-1", resourceId: "offer-1", operation: "approveOffer", approvedBy: "owner", approvedAt: "soon", reason: "Revisada", draftHash: "sha256:v1" }] }), { status: 200, headers: { "content-type": "application/json" } });
  const approvalClient = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, approvals);
  await assert.rejects(() => approvalClient.approvals(), /INVALID_WORKSPACE_APPROVALS/);
  const effects: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", effects: [{ id: "e", caseId: "case-1", kind: "send", status: "pending", requestedBy: "owner", requestedAt: "soon", payload: {} }] }), { status: 200, headers: { "content-type": "application/json" } });
  const effectClient = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, effects);
  await assert.rejects(() => effectClient.effects(), /INVALID_WORKSPACE_EFFECTS/);
});

test("workspace client rejects effects with non-object payloads", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", effects: [{ id: "e", caseId: "case-1", kind: "send", status: "pending", requestedBy: "owner", requestedAt: "2026-09-30T10:00:00Z", payload: [] }] }), { status: 200, headers: { "content-type": "application/json" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => client.effects(), /INVALID_WORKSPACE_EFFECTS/);
});

test("workspace client rejects malformed effect retry counters", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", effects: [{ id: "e", caseId: "case-1", kind: "send", status: "pending", requestedBy: "owner", requestedAt: "2026-09-30T10:00:00Z", retryCount: -1, payload: {} }] }), { status: 200, headers: { "content-type": "application/json" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => client.effects(), /INVALID_WORKSPACE_EFFECTS/);
});

test("workspace client rejects malformed effect execution metadata", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", effects: [{ id: "e", caseId: "case-1", kind: "send", status: "succeeded", requestedBy: "owner", requestedAt: "2026-09-30T10:00:00Z", executionNote: "x".repeat(2_001), executedBy: "owner", executedAt: "2026-09-30T10:01:00Z", payload: {} }] }), { status: 200, headers: { "content-type": "application/json" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => client.effects(), /INVALID_WORKSPACE_EFFECTS/);
});

test("workspace client rejects malformed effect confirmation metadata", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", effects: [{ id: "e", caseId: "case-1", kind: "send", status: "confirmed", requestedBy: "owner", requestedAt: "2026-09-30T10:00:00Z", confirmedBy: "owner", confirmedAt: "soon", payload: {} }] }), { status: 200, headers: { "content-type": "application/json" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => client.effects(), /INVALID_WORKSPACE_EFFECTS/);
});

test("workspace client rejects oversized effect draft hashes", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", effects: [{ id: "e", caseId: "case-1", kind: "send", status: "pending", requestedBy: "owner", requestedAt: "2026-09-30T10:00:00Z", draftHash: "x".repeat(513), payload: {} }] }), { status: 200, headers: { "content-type": "application/json" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => client.effects(), /INVALID_WORKSPACE_EFFECTS/);
});

test("workspace client rejects oversized approval reasons", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ approvals: [{ id: "a", tenantId: "agency-1", resourceId: "offer-1", operation: "approveOffer", approvedBy: "owner", approvedAt: "2026-09-30T10:00:00Z", reason: "x".repeat(2_001), draftHash: "sha256:v1" }] }), { status: 200, headers: { "content-type": "application/json" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => client.approvals(), /INVALID_WORKSPACE_APPROVALS/);
});

test("workspace client rejects duplicate approval and effect identifiers", async () => {
  const approval: typeof fetch = async () => new Response(JSON.stringify({ approvals: [
    { id: "a", tenantId: "agency-1", resourceId: "offer-1", operation: "approveOffer", approvedBy: "owner", approvedAt: "2026-09-30T10:00:00Z", reason: "Revisada", draftHash: "sha256:v1" },
    { id: "a", tenantId: "agency-1", resourceId: "offer-2", operation: "approveOffer", approvedBy: "owner", approvedAt: "2026-09-30T10:01:00Z", reason: "Revisada", draftHash: "sha256:v2" }
  ] }), { status: 200, headers: { "content-type": "application/json" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, approval);
  await assert.rejects(() => client.approvals(), /INVALID_WORKSPACE_APPROVALS/);
});

test("workspace client rejects duplicate inbox identifiers", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ items: [
    { id: "case-1", tenantId: "agency-1", state: "pending_review", summary: "Primero" },
    { id: "case-1", tenantId: "agency-1", state: "pending_review", summary: "Duplicado" }
  ] }), { status: 200, headers: { "content-type": "application/json" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => client.inbox(), /INVALID_WORKSPACE_INBOX/);
});

test("workspace client rejects empty inbox and approval envelopes for another tenant", async () => {
  const inbox = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, async () => new Response(JSON.stringify({ tenantId: "agency-2", items: [] }), { status: 200, headers: { "content-type": "application/json" } }));
  await assert.rejects(() => inbox.inbox(), /INVALID_WORKSPACE_INBOX/);
  const approvals = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, async () => new Response(JSON.stringify({ tenantId: "agency-2", approvals: [] }), { status: 200, headers: { "content-type": "application/json" } }));
  await assert.rejects(() => approvals.approvals(), /INVALID_WORKSPACE_APPROVALS/);
});

test("workspace client rejects duplicate audit identifiers", async () => {
  const entry = { id: "audit-1", caseId: "case-1", from: "received", to: "accepted", operation: "transition", actorId: "owner", at: "2026-09-30T10:00:00Z", version: 1 };
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", caseId: "case-1", audit: [entry, { ...entry, version: 2 }] }), { status: 200, headers: { "content-type": "application/json" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => client.audit("case-1"), /INVALID_WORKSPACE_AUDIT/);
});

test("workspace client rejects non-monotonic audit versions", async () => {
  const entry = { id: "audit-1", caseId: "case-1", from: "received", to: "accepted", operation: "transition", actorId: "owner", at: "2026-09-30T10:00:00Z", version: 2 };
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", caseId: "case-1", audit: [entry, { ...entry, id: "audit-2", version: 1 }] }), { status: 200, headers: { "content-type": "application/json" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => client.audit("case-1"), /INVALID_WORKSPACE_AUDIT/);
});

test("workspace client rejects oversized remote collections", async () => {
  const items = Array.from({ length: 10_001 }, (_, index) => ({ id: `case-${index}`, tenantId: "agency-1", state: "pending_review", summary: "Caso" }));
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ items }), { status: 200, headers: { "content-type": "application/json" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => client.inbox(), /INVALID_WORKSPACE_INBOX/);
});

test("workspace client rejects oversized inbox summaries", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ items: [{ id: "case-1", tenantId: "agency-1", state: "pending_review", summary: "x".repeat(4_001) }] }), { status: 200, headers: { "content-type": "application/json" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => client.inbox(), /INVALID_WORKSPACE_INBOX/);
});

test("workspace client exposes and validates inbox source provenance", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", items: [{ id: "case-1", tenantId: "agency-1", state: "received", summary: "Mensaje", sourceEventId: "event-1", sourceExternalMessageId: "wa-1", sourceChannel: "whatsapp" }] }), { status: 200, headers: { "content-type": "application/json" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  assert.equal((await client.inbox())[0]?.sourceChannel, "whatsapp");
  const invalid: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", items: [{ id: "case-1", tenantId: "agency-1", state: "received", summary: "Mensaje", sourceChannel: "whatsapp\n" }] }), { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(() => new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, invalid).inbox(), /INVALID_WORKSPACE_INBOX/);
  const unknown: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", items: [{ id: "case-1", tenantId: "agency-1", state: "received", summary: "Mensaje", sourceChannel: "carrier-pigeon" }] }), { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(() => new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, unknown).inbox(), /INVALID_WORKSPACE_INBOX/);
});

test("workspace client rejects malformed optional inbox metadata", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ items: [{ id: "case-1", tenantId: "agency-1", state: "pending_review", summary: "Caso", version: -1, updatedAt: "soon" }] }), { status: 200, headers: { "content-type": "application/json" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => client.inbox(), /INVALID_WORKSPACE_INBOX/);
});

test("workspace client rejects oversized response headers before parsing", async () => {
  const fetcher: typeof fetch = async () => new Response("{}", { status: 200, headers: { "content-type": "application/json", "content-length": "1048577" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => client.inbox(), /WORKSPACE_RESPONSE_TOO_LARGE/);
});

test("workspace client normalizes malformed remote JSON", async () => {
  const fetcher: typeof fetch = async () => new Response("not-json", { status: 200, headers: { "content-type": "application/json" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => client.inbox(), /INVALID_WORKSPACE_RESPONSE/);
});

test("workspace client measures response body when content length is absent", async () => {
  const oversized = JSON.stringify({ items: [{ id: "case-1", tenantId: "agency-1", state: "pending_review", summary: "x".repeat(1_048_500) }] });
  const fetcher: typeof fetch = async () => new Response(oversized, { status: 200, headers: { "content-type": "application/json" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => client.inbox(), /WORKSPACE_RESPONSE_TOO_LARGE/);
});

test("workspace client rejects a declared non-JSON response", async () => {
  const fetcher: typeof fetch = async () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
  const client = new WorkspaceClient({ baseUrl: "http://127.0.0.1:8799", tenantId: "agency-1", token: "token-1234567890" }, fetcher);
  await assert.rejects(() => client.inbox(), /INVALID_WORKSPACE_CONTENT_TYPE/);
});

test("workspace client reads an individual effect", async () => {
  const api = new WorkspaceApi();
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  api.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects", authorization: "Bearer owner-token-123456",
    body: { id: "effect-client", caseId: "case-1", kind: "crm_task", payload: { title: "Llamar" },
      requestedAt: "2026-09-29T14:00:00Z", draftHash: "sha256:test" } });
  const fetcher: typeof fetch = (input, init) => handlePymesRequest(api, new Request(String(input), init));
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  const effect = await value.effect("effect-client");
  assert.equal(effect.kind, "crm_task");
  assert.equal(effect.status, "pending");
  assert.equal((await value.effectsForCase("case-1")).length, 1);
});

test("workspace client rejects unsafe remote effect identifiers", async () => {
  const effect = { id: "effect-1\n", caseId: "case-1", kind: "call", status: "pending",
    requestedBy: "owner", requestedAt: "2026-09-29T14:00:00Z", payload: {} };
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", effects: [effect] }), {
    status: 200, headers: { "content-type": "application/json" } });
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await assert.rejects(() => value.effects(), /INVALID_WORKSPACE_EFFECTS/);
});

test("workspace client rejects unknown remote effect states", async () => {
  const effect = { tenantId: "agency-1", id: "effect-1", caseId: "case-1", kind: "webhook", status: "queued",
    requestedBy: "owner", requestedAt: "2026-09-29T14:00:00Z", retryCount: 0, draftHash: "sha256:x", payload: { value: true } };
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", effects: [effect] }), {
    status: 200, headers: { "content-type": "application/json" } });
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await assert.rejects(() => value.effects(), /INVALID_WORKSPACE_EFFECTS/);
});

test("workspace client rejects a valid effect belonging to another tenant", async () => {
  const effect = { tenantId: "agency-2", id: "effect-1", caseId: "case-1", kind: "call", status: "pending",
    requestedBy: "owner", requestedAt: "2026-09-29T14:00:00Z", retryCount: 0, draftHash: "sha256:x", payload: { phone: "+34600000000" } };
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-1", effects: [effect] }), {
    status: 200, headers: { "content-type": "application/json" } });
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await assert.rejects(() => value.effects(), /INVALID_WORKSPACE_EFFECTS/);
});

test("workspace client performs an authenticated case transition", async () => {
  const api = new WorkspaceApi();
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  api.addInbox({ id: "case-client", tenantId: "agency-1", state: "approved", summary: "Caso listo" });
  const fetcher: typeof fetch = (input, init) => handlePymesRequest(api, new Request(String(input), init));
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await value.transition("case-client", "executing", "2026-09-29T15:00:00Z", 0);
  assert.equal((await value.inbox())[0]?.state, "executing");
});

test("workspace client creates a governed effect draft", async () => {
  const api = new WorkspaceApi();
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  const fetcher: typeof fetch = (input, init) => handlePymesRequest(api, new Request(String(input), init));
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  const effect = await value.createEffect({ id: "call-draft-1", caseId: "case-client", kind: "call",
    payload: { phone: "+34600000000", purpose: "Revisar renovación" }, requestedAt: "2026-09-29T15:00:00Z", draftHash: "sha256:draft" });
  assert.equal(effect.status, "pending");
  assert.equal(effect.kind, "call");
  await assert.rejects(() => value.createEffect({ id: "bad", caseId: "case-client", kind: "call", payload: {}, draftHash: "sha256:x" }), /INVALID_WORKSPACE_EFFECT_INPUT/);
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  await assert.rejects(() => value.createEffect({ id: "circular", caseId: "case-client", kind: "call", payload: circular, draftHash: "sha256:x" }), /INVALID_WORKSPACE_EFFECT_INPUT/);
});

test("workspace client exposes current version on transition conflict", async () => {
  const api = new WorkspaceApi();
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  api.addInbox({ id: "case-conflict", tenantId: "agency-1", state: "approved", summary: "Caso", version: 3 });
  const fetcher: typeof fetch = (input, init) => handlePymesRequest(api, new Request(String(input), init));
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await assert.rejects(() => value.transition("case-conflict", "executing", "2026-09-29T15:00:00Z", 2),
    (error: unknown) => error instanceof WorkspaceConflictError && error.currentVersion === 3);
});

test("workspace client retries a failed effect through the API", async () => {
  const api = new WorkspaceApi();
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  api.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects", authorization: "Bearer owner-token-123456",
    body: { id: "effect-retry", caseId: "case-1", kind: "call", payload: { phone: "+34600000000" }, requestedAt: "2026-09-29T14:00:00Z", draftHash: "sha256:test" } });
  api.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects/effect-retry/confirm", authorization: "Bearer owner-token-123456",
    body: { confirm: true, confirmedAt: "2026-09-29T14:01:00Z" } });
  api.handle({ method: "POST", path: "/v1/workspaces/agency-1/effects/effect-retry/result", authorization: "Bearer owner-token-123456",
    body: { result: "failed", executedAt: "2026-09-29T14:02:00Z", note: "No responde" } });
  const fetcher: typeof fetch = (input, init) => handlePymesRequest(api, new Request(String(input), init));
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  const retry = await value.retryEffect("effect-retry", "Nueva franja disponible", "2026-09-29T15:00:00Z");
  assert.equal(retry.status, "pending");
});

test("workspace client rejects invalid configuration", () => {
  assert.throws(() => new WorkspaceClient({ baseUrl: "", tenantId: "a", token: "t" }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "a", token: "short" }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "a", token: "x".repeat(4097) }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "x".repeat(201), token: "owner-token-123456" }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: "not-a-url", tenantId: "agency-1", token: "owner-token-123456" }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: "https://user:pass@workspace.local", tenantId: "agency-1", token: "owner-token-123456" }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: "https://workspace.local/?tenant=other", tenantId: "agency-1", token: "owner-token-123456" }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: `https://${"a".repeat(2040)}.local`, tenantId: "agency-1", token: "owner-token-123456" }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1\nother", token: "owner-token-123456" }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456", requestTimeoutMs: 99 }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
  assert.throws(() => new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123\n456" }),
    /INVALID_WORKSPACE_CLIENT_CONFIG/);
});

test("workspace client can revoke its current session", async () => {
  const api = new WorkspaceApi();
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  const fetcher: typeof fetch = (input, init) => handlePymesRequest(api, new Request(String(input), init));
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await value.revokeSession();
  await assert.rejects(() => value.inbox(), /UNAUTHENTICATED/);
});

test("workspace client rejects an incoherent revoke response", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ tenantId: "agency-2", status: "revoked" }), { status: 200, headers: { "content-type": "application/json" } });
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await assert.rejects(() => value.revokeSession(), /INVALID_WORKSPACE_REVOKE_RESPONSE/);
});

test("workspace client trims endpoint and credential configuration", async () => {
  const api = new WorkspaceApi();
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  const fetcher: typeof fetch = (input, init) => handlePymesRequest(api, new Request(String(input), init));
  const value = new WorkspaceClient({ baseUrl: " http://workspace.local/ ", tenantId: " agency-1 ", token: " owner-token-123456 " }, fetcher);
  assert.equal((await value.inbox()).length, 0);
});

test("workspace client aborts a request after its configured timeout", async () => {
  const fetcher: typeof fetch = async (_input, init) => await new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
  });
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456", requestTimeoutMs: 100 }, fetcher);
  await assert.rejects(() => value.inbox(), /WORKSPACE_REQUEST_TIMEOUT/);
});

test("workspace client sends a correlation request id", async () => {
  const api = new WorkspaceApi();
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency-1", role: "owner" });
  let seen = "";
  const fetcher: typeof fetch = async (input, init) => {
    seen = new Headers(init?.headers).get("x-request-id") ?? "";
    return handlePymesRequest(api, new Request(String(input), init));
  };
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await value.inbox();
  assert.match(seen, /^[0-9a-f-]{36}$/);
  assert.equal(value.lastRequestId, seen);
  assert.equal(value.lastStatus, 200);
});

test("workspace client disables intermediary caching", async () => {
  let cacheControl = "";
  const fetcher: typeof fetch = async (_input, init) => {
    cacheControl = new Headers(init?.headers).get("cache-control") ?? "";
    return new Response(JSON.stringify({ status: "ok", service: "pymes-workspace", version: "0.1.0" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await value.health();
  assert.equal(cacheControl, "no-store");
});

test("workspace client clears last status when transport fails", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ status: "ok", service: "pymes-workspace", version: "0.1.0" }), { status: 200, headers: { "content-type": "application/json" } });
    throw new Error("OFFLINE");
  };
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await value.health();
  assert.equal(value.lastStatus, 200);
  await assert.rejects(() => value.health(), /OFFLINE/);
  assert.equal(value.lastStatus, null);
  assert.equal(value.lastResponseRequestId, null);
});

test("workspace client exposes the response correlation id", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ status: "ok", service: "pymes-workspace", version: "0.1.0" }), { status: 200, headers: { "content-type": "application/json", "x-request-id": " gateway-42 " } });
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await value.health();
  assert.equal(value.lastResponseRequestId, "gateway-42");
});

test("workspace client rejects oversized health metadata", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ status: "ok", service: "pymes-workspace", version: "x".repeat(201) }), { status: 200, headers: { "content-type": "application/json" } });
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await assert.rejects(() => value.health(), /INVALID_WORKSPACE_HEALTH/);
});

test("workspace client rejects malformed readiness retry metadata", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ status: "not_ready", service: "pymes-workspace", version: "0.1.0", retryAfter: "x".repeat(201) }), { status: 200, headers: { "content-type": "application/json" } });
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await assert.rejects(() => value.ready(), /INVALID_WORKSPACE_READINESS/);
});

test("workspace client drops oversized retry metadata", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ error: "TEMPORARY" }), { status: 503, headers: { "content-type": "application/json", "retry-after": "x".repeat(201) } });
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await assert.rejects(async () => value.health(), error => error instanceof WorkspaceHttpError && error.retryAfter === null);
});

test("workspace client bounds remote HTTP error messages", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ error: "x".repeat(201) }), { status: 503, headers: { "content-type": "application/json" } });
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await assert.rejects(async () => value.health(), error => error instanceof WorkspaceHttpError && error.message === "WORKSPACE_REQUEST_FAILED");
});

test("workspace client drops oversized response correlation ids", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ status: "ok", service: "pymes-workspace", version: "0.1.0" }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "x".repeat(201) } });
  const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" }, fetcher);
  await value.health();
  assert.equal(value.lastResponseRequestId, null);
});

test("workspace client rejects cross-tenant or malformed metrics", async () => {
  const responses: Array<Record<string, unknown>> = [
    { tenantId: "agency-2", generatedAt: "2026-09-30T10:00:00Z", inbox: { total: 0, byState: {} }, effects: { total: 0, byStatus: {} }, approvals: { total: 0 } },
    { tenantId: "agency-1", generatedAt: "2026-09-30T10:00:00Z", inbox: { total: -1, byState: {} }, effects: { total: 0, byStatus: {} }, approvals: { total: 0 } }
  ];
  responses.push({ tenantId: "agency-1", generatedAt: "not-a-date", inbox: { total: 0, byState: {} }, effects: { total: 0, byStatus: {} }, approvals: { total: 0 } });
  responses.push({ tenantId: "agency-1", generatedAt: "2026-09-30T10:00:00Z", inbox: { total: 2, byState: { pending_review: 1 } }, effects: { total: 0, byStatus: {} }, approvals: { total: 0 } });
  responses.push({ tenantId: "agency-1", generatedAt: "2026-09-30T10:00:00Z", inbox: { total: 0, byState: {} }, effects: { total: 0, byStatus: {} }, approvals: { total: 0 }, alerts: [{ code: "UNKNOWN", severity: "critical", count: 1 }] });
  for (const body of responses) {
    const value = new WorkspaceClient({ baseUrl: "http://workspace.local", tenantId: "agency-1", token: "owner-token-123456" },
      async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
    await assert.rejects(() => value.metrics(), /INVALID_WORKSPACE_METRICS/);
  }
});
