import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SqliteWorkspaceRepository } from "../src/workspace-store-sqlite.js";

test("SQLite repository survives a repository restart", () => {
  const directory = mkdtempSync(join(tmpdir(), "pymes-workspace-"));
  const path = join(directory, "workspace.db");
  const first = new SqliteWorkspaceRepository(path);
  first.provisionSession("token-1", { userId: "owner", tenantId: "agency-1", role: "owner" });
  first.appendInbox({ id: "msg-1", tenantId: "agency-1", state: "pending_review", summary: "Oferta" });
  first.appendApproval({ id: "approval-1", tenantId: "agency-1", resourceId: "offer-1",
    operation: "approveOffer", approvedBy: "owner", approvedAt: "2026-09-29T12:00:00Z",
    reason: "Revisada", draftHash: "sha256:v1" });
  assert.equal(first.findSession("token-1")?.tenantId, "agency-1");
  assert.equal(first.listInbox("agency-1").length, 1);
  assert.equal(first.listApprovals("agency-1").length, 1);
  first.close();
  const second = new SqliteWorkspaceRepository(path);
  assert.equal(second.findSession("token-1")?.userId, "owner");
  assert.equal(second.listInbox("agency-1")[0]?.id, "msg-1");
  assert.equal(second.listApprovals("agency-1")[0]?.id, "approval-1");
  second.close();
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
