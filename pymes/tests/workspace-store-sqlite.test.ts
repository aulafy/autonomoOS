import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { SqliteWorkspaceRepository } from "../src/workspace-store-sqlite.js";

test("SQLite repository survives a repository restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "pymes-workspace-"));
  const path = join(directory, "workspace.db");
  const first = new SqliteWorkspaceRepository(path);
  first.provisionSession("token-1234567890", { userId: "owner", tenantId: "agency-1", role: "owner" });
  first.appendInbox({ id: "msg-1", tenantId: "agency-1", state: "pending_review", summary: "Oferta",
    sourceEventId: "event-1", sourceExternalMessageId: "wa-1", sourceChannel: "whatsapp" });
  first.appendApproval({ id: "approval-1", tenantId: "agency-1", resourceId: "offer-1",
    operation: "approveOffer", approvedBy: "owner", approvedAt: "2026-09-29T12:00:00Z",
    reason: "Revisada", draftHash: "sha256:v1" });
  assert.equal(first.findSession("token-1234567890")?.tenantId, "agency-1");
  assert.equal(first.listInbox("agency-1").length, 1);
  assert.equal(first.listApprovals("agency-1").length, 1);
  first.close();
  const second = new SqliteWorkspaceRepository(path);
  assert.equal(second.findSession("token-1234567890")?.userId, "owner");
  assert.equal(second.listInbox("agency-1")[0]?.id, "msg-1");
  assert.equal(second.listInbox("agency-1")[0]?.sourceExternalMessageId, "wa-1");
  assert.equal(second.listApprovals("agency-1")[0]?.id, "approval-1");
  second.close();
  rmSync(directory, { recursive: true, force: true });
});

test("SQLite inbox updates preserve OpenClaw provenance", () => {
  const store = new SqliteWorkspaceRepository(":memory:");
  store.appendInbox({ id: "msg-1", tenantId: "agency-1", state: "received", summary: "Mensaje",
    sourceEventId: "event-1", sourceExternalMessageId: "wa-1", sourceChannel: "whatsapp" });
  store.updateInbox({ id: "msg-1", tenantId: "agency-1", state: "pending_review", summary: "Revisar",
    version: 1, sourceEventId: "event-1", sourceExternalMessageId: "wa-1", sourceChannel: "whatsapp" });
  assert.deepEqual(store.listInbox("agency-1")[0], { id: "msg-1", tenantId: "agency-1", state: "pending_review", summary: "Revisar",
    sourceEventId: "event-1", sourceExternalMessageId: "wa-1", sourceChannel: "whatsapp", version: 1 });
  store.close();
});

test("SQLite audit of OpenClaw ingress survives restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "pymes-audit-"));
  const path = join(directory, "workspace.db");
  const first = new SqliteWorkspaceRepository(path);
  first.appendCaseAudit({ id: "audit-event-1", tenantId: "agency-1", caseId: "openclaw:event-1",
    from: "received", to: "received", operation: "openclaw_ingress", actorId: "openclaw-gateway",
    at: "2026-09-30T10:00:00Z", version: 0, requestId: "req-ingress-1" });
  first.close();
  const second = new SqliteWorkspaceRepository(path);
  assert.deepEqual(second.listCaseAudit("agency-1", "openclaw:event-1")[0]?.requestId, "req-ingress-1");
  second.close();
  rmSync(directory, { recursive: true, force: true });
});

test("SQLite migrates legacy audit schema without losing entries", () => {
  const directory = mkdtempSync(join(tmpdir(), "pymes-legacy-audit-"));
  const path = join(directory, "workspace.db");
  const legacy = new DatabaseSync(path);
  legacy.exec("CREATE TABLE workspace_case_audit (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, case_id TEXT NOT NULL, from_state TEXT NOT NULL, to_state TEXT NOT NULL, operation TEXT NOT NULL, actor_id TEXT NOT NULL, at TEXT NOT NULL, version INTEGER NOT NULL)");
  legacy.prepare("INSERT INTO workspace_case_audit (id, tenant_id, case_id, from_state, to_state, operation, actor_id, at, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("legacy-1", "agency-1", "case-1", "received", "approved", "transition", "owner", "2026-09-30T10:00:00Z", 1);
  legacy.close();
  const store = new SqliteWorkspaceRepository(path);
  assert.equal(store.listCaseAudit("agency-1", "case-1")[0]?.operation, "transition");
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

test("SQLite repository stores session hashes and authenticates legacy sessions", () => {
  const directory = mkdtempSync(join(tmpdir(), "pymes-session-"));
  const repository = new SqliteWorkspaceRepository(join(directory, "workspace.db"));
  repository.provisionSession("secure-session-token", { userId: "owner", tenantId: "agency-1", role: "owner" });
  const stored = repository.db.prepare("SELECT token FROM workspace_sessions").get() as { token: string };
  assert.notEqual(stored.token, "secure-session-token");
  assert.equal(stored.token.length, 64);
  repository.db.prepare("UPDATE workspace_sessions SET token = ?").run("legacy-session-token");
  assert.equal(repository.findSession("legacy-session-token")?.userId, "owner");
  const migrated = repository.db.prepare("SELECT token FROM workspace_sessions").get() as { token: string };
  assert.equal(migrated.token.length, 64);
  repository.close();
  rmSync(directory, { recursive: true, force: true });
});

test("SQLite repository revokes hashed sessions durably", () => {
  const directory = mkdtempSync(join(tmpdir(), "pymes-revoke-"));
  const path = join(directory, "workspace.db");
  const repository = new SqliteWorkspaceRepository(path);
  repository.provisionSession("revoke-session-token", { userId: "owner", tenantId: "agency-1", role: "owner" });
  assert.equal(repository.findSession("revoke-session-token")?.userId, "owner");
  repository.revokeSession("revoke-session-token");
  assert.equal(repository.findSession("revoke-session-token"), null);
  repository.close();
  const reopened = new SqliteWorkspaceRepository(path);
  assert.equal(reopened.findSession("revoke-session-token"), null);
  reopened.close();
  rmSync(directory, { recursive: true, force: true });
});

test("SQLite session provisioning rejects invalid token sizes", () => {
  const store = new SqliteWorkspaceRepository(":memory:");
  assert.throws(() => store.provisionSession("short", { userId: "owner", tenantId: "agency-1", role: "owner" }), /INVALID_SESSION_TOKEN/);
  assert.throws(() => store.provisionSession("x".repeat(4097), { userId: "owner", tenantId: "agency-1", role: "owner" }), /INVALID_SESSION_TOKEN/);
  store.close();
});

test("SQLite repository never returns another tenant's records", () => {
  const store = new SqliteWorkspaceRepository(":memory:");
  store.appendInbox({ id: "private", tenantId: "agency-2", state: "received", summary: "Privado" });
  store.appendApproval({ id: "a2", tenantId: "agency-2", resourceId: "x",
    operation: "approveOffer", approvedBy: "u", approvedAt: "2026-09-29T12:00:00Z",
    reason: "Revisada", draftHash: "sha256:v1" });
  assert.deepEqual(store.listInbox("agency-1"), []);
  assert.deepEqual(store.listApprovals("agency-1"), []);
  store.close();
});

test("SQLite inbox updates are explicit and duplicate inserts fail", () => {
  const store = new SqliteWorkspaceRepository(":memory:");
  const record = { id: "msg-1", tenantId: "agency-1", state: "received" as const, summary: "Inicial" };
  store.appendInbox(record);
  assert.throws(() => store.appendInbox(record));
  store.updateInbox({ ...record, state: "classified", summary: "Actualizado", version: 2 });
  assert.deepEqual(store.listInbox("agency-1"), [{ ...record, state: "classified", summary: "Actualizado", version: 2 }]);
  assert.deepEqual(store.listInbox("agency-2"), []);
  store.close();
});

test("SQLite inbox enforces external message idempotency", () => {
  const store = new SqliteWorkspaceRepository(":memory:");
  store.appendInbox({ id: "event-1", tenantId: "agency-1", state: "received", summary: "Mensaje", sourceExternalMessageId: "wa-1", sourceChannel: "whatsapp" });
  assert.throws(() => store.appendInbox({ id: "event-2", tenantId: "agency-1", state: "received", summary: "Reintento", sourceExternalMessageId: "wa-1", sourceChannel: "whatsapp" }));
  store.close();
});

test("SQLite effects fail closed when stored payload is corrupt", () => {
  const store = new SqliteWorkspaceRepository(":memory:");
  store.db.prepare(`INSERT INTO workspace_effects (id, tenant_id, case_id, kind, payload, status, requested_by, requested_at, retry_count, draft_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "effect-1", "agency-1", "case-1", "call", "not-json", "pending", "owner", "2026-09-30T10:00:00Z", 0, "sha256:test");
  assert.deepEqual(store.listEffects("agency-1"), []);
  store.close();
});
