import { DatabaseSync } from "node:sqlite";
import { hashSessionToken } from "./auth.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ApprovalRecord, CaseAuditRecord, WorkspaceInboxRecord, WorkspacePrincipal,
  WorkspaceRepository } from "./workspace-api.js";
import type { PendingEffect } from "./effects.js";

/** Small durable repository. The API owns policy; this class owns persistence only. */
export class SqliteWorkspaceRepository implements WorkspaceRepository {
  readonly db: DatabaseSync;
  constructor(readonly path: string) {
    if (!path) throw new Error("WORKSPACE_DB_PATH_REQUIRED");
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS workspace_sessions (
        token TEXT PRIMARY KEY, user_id TEXT NOT NULL, tenant_id TEXT NOT NULL, role TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_inbox (
        id TEXT NOT NULL, tenant_id TEXT NOT NULL, state TEXT NOT NULL, summary TEXT NOT NULL,
        source_event_id TEXT, source_external_message_id TEXT, source_channel TEXT,
        version INTEGER NOT NULL DEFAULT 0, updated_at TEXT,
        PRIMARY KEY (tenant_id, id)
      );
      CREATE TABLE IF NOT EXISTS workspace_approvals (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, resource_id TEXT NOT NULL,
        operation TEXT NOT NULL, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL,
        reason TEXT NOT NULL, draft_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_case_audit (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, case_id TEXT NOT NULL,
        from_state TEXT NOT NULL, to_state TEXT NOT NULL, operation TEXT NOT NULL,
        actor_id TEXT NOT NULL, at TEXT NOT NULL, version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_effects (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, case_id TEXT NOT NULL, kind TEXT NOT NULL,
        payload TEXT NOT NULL, status TEXT NOT NULL, requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL, retry_count INTEGER NOT NULL DEFAULT 0, confirmed_by TEXT, confirmed_at TEXT, executed_by TEXT, executed_at TEXT, execution_note TEXT, draft_hash TEXT NOT NULL
      );`);
    // Keep databases created by the previous inbox schema readable.
    try { this.db.exec("ALTER TABLE workspace_inbox ADD COLUMN version INTEGER NOT NULL DEFAULT 0"); } catch {}
    try { this.db.exec("ALTER TABLE workspace_inbox ADD COLUMN updated_at TEXT"); } catch {}
    try { this.db.exec("ALTER TABLE workspace_inbox ADD COLUMN source_event_id TEXT"); } catch {}
    try { this.db.exec("ALTER TABLE workspace_inbox ADD COLUMN source_external_message_id TEXT"); } catch {}
    try { this.db.exec("ALTER TABLE workspace_inbox ADD COLUMN source_channel TEXT"); } catch {}
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS workspace_inbox_external_message ON workspace_inbox(tenant_id, source_external_message_id, source_channel) WHERE source_external_message_id IS NOT NULL AND source_channel IS NOT NULL");
    try { this.db.exec("ALTER TABLE workspace_effects ADD COLUMN confirmed_by TEXT"); } catch {}
    try { this.db.exec("ALTER TABLE workspace_effects ADD COLUMN confirmed_at TEXT"); } catch {}
    try { this.db.exec("ALTER TABLE workspace_effects ADD COLUMN executed_by TEXT"); } catch {}
    try { this.db.exec("ALTER TABLE workspace_effects ADD COLUMN executed_at TEXT"); } catch {}
    try { this.db.exec("ALTER TABLE workspace_effects ADD COLUMN execution_note TEXT"); } catch {}
    try { this.db.exec("ALTER TABLE workspace_effects ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0"); } catch {}
  }
  provisionSession(token: string, principal: WorkspacePrincipal): void {
    if (!token || token.length < 16 || token.length > 4096) throw new Error("INVALID_SESSION_TOKEN");
    this.db.prepare(`INSERT OR REPLACE INTO workspace_sessions
      (token, user_id, tenant_id, role) VALUES (?, ?, ?, ?)`).run(hashSessionToken(token),
      principal.userId, principal.tenantId, principal.role);
  }
  findSession(token: string): WorkspacePrincipal | null {
    const hash = hashSessionToken(token);
    const row = this.db.prepare(`SELECT user_id, tenant_id, role FROM workspace_sessions WHERE token = ?`).get(hash) as
      { user_id: string; tenant_id: string; role: WorkspacePrincipal["role"] } | undefined;
    if (row) return { userId: row.user_id, tenantId: row.tenant_id, role: row.role };
    const legacy = this.db.prepare(`SELECT token, user_id, tenant_id, role FROM workspace_sessions WHERE token = ?`).get(token) as
      { token: string; user_id: string; tenant_id: string; role: WorkspacePrincipal["role"] } | undefined;
    if (!legacy) return null;
    this.db.prepare("UPDATE workspace_sessions SET token = ? WHERE token = ?").run(hash, legacy.token);
    return { userId: legacy.user_id, tenantId: legacy.tenant_id, role: legacy.role };
  }
  revokeSession(token: string): void {
    this.db.prepare("DELETE FROM workspace_sessions WHERE token = ? OR token = ?").run(hashSessionToken(token), token);
  }
  listInbox(tenantId: string): WorkspaceInboxRecord[] {
    const rows = this.db.prepare(`SELECT id, tenant_id, state, summary, source_event_id, source_external_message_id, source_channel, version, updated_at FROM workspace_inbox
      WHERE tenant_id = ? ORDER BY rowid`).all(tenantId) as Array<{ id: string; tenant_id: string;
        state: WorkspaceInboxRecord["state"]; summary: string; source_event_id: string | null; source_external_message_id: string | null; source_channel: WorkspaceInboxRecord["sourceChannel"] | null; version: number; updated_at: string | null }>;
    return rows.map(row => ({ id: row.id, tenantId: row.tenant_id, state: row.state, summary: row.summary,
      ...(row.source_event_id ? { sourceEventId: row.source_event_id } : {}),
      ...(row.source_external_message_id ? { sourceExternalMessageId: row.source_external_message_id } : {}),
      ...(row.source_channel ? { sourceChannel: row.source_channel } : {}),
      version: row.version, ...(row.updated_at ? { updatedAt: row.updated_at } : {}) }));
  }
  appendInbox(record: WorkspaceInboxRecord): void {
    this.db.prepare(`INSERT INTO workspace_inbox
      (id, tenant_id, state, summary, source_event_id, source_external_message_id, source_channel, version, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(record.id, record.tenantId,
      record.state, record.summary, record.sourceEventId ?? null, record.sourceExternalMessageId ?? null, record.sourceChannel ?? null, record.version ?? 0, record.updatedAt ?? null);
  }
  updateInbox(record: WorkspaceInboxRecord): void {
    this.db.prepare(`UPDATE workspace_inbox SET state = ?, summary = ?, source_event_id = ?, source_external_message_id = ?, source_channel = ?, version = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ?`).run(record.state, record.summary,
      record.sourceEventId ?? null, record.sourceExternalMessageId ?? null, record.sourceChannel ?? null, record.version ?? 0,
      record.updatedAt ?? null, record.id, record.tenantId);
  }
  appendCaseAudit(record: CaseAuditRecord): void {
    this.db.prepare(`INSERT INTO workspace_case_audit
      (id, tenant_id, case_id, from_state, to_state, operation, actor_id, at, version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(record.id, record.tenantId, record.caseId,
      record.from, record.to, record.operation, record.actorId, record.at, record.version);
  }
  listCaseAudit(tenantId: string, caseId: string): CaseAuditRecord[] {
    const rows = this.db.prepare(`SELECT id, tenant_id, case_id, from_state, to_state,
      operation, actor_id, at, version FROM workspace_case_audit
      WHERE tenant_id = ? AND case_id = ? ORDER BY version`).all(tenantId, caseId) as Array<any>;
    return rows.map(row => ({ id: row.id, tenantId: row.tenant_id, caseId: row.case_id,
      from: row.from_state, to: row.to_state, operation: row.operation,
      actorId: row.actor_id, at: row.at, version: row.version }));
  }
  appendEffect(effect: PendingEffect): void { this.db.prepare(`INSERT INTO workspace_effects
    (id, tenant_id, case_id, kind, payload, status, requested_by, requested_at, retry_count, confirmed_by, confirmed_at, draft_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(effect.id, effect.tenantId, effect.caseId, effect.kind,
    JSON.stringify(effect.payload), effect.status, effect.requestedBy, effect.requestedAt, effect.retryCount, effect.confirmedBy ?? null, effect.confirmedAt ?? null, effect.draftHash); }
  updateEffect(effect: PendingEffect): void { this.db.prepare(`UPDATE workspace_effects SET status = ?, retry_count = ?, confirmed_by = ?, confirmed_at = ?, executed_by = ?, executed_at = ?, execution_note = ? WHERE id = ? AND tenant_id = ?`).run(effect.status, effect.retryCount, effect.confirmedBy ?? null, effect.confirmedAt ?? null, effect.executedBy ?? null, effect.executedAt ?? null, effect.executionNote ?? null, effect.id, effect.tenantId); }
  listEffects(tenantId: string, caseId?: string): PendingEffect[] {
    const rows = this.db.prepare(`SELECT id, tenant_id, case_id, kind, payload, status, requested_by, requested_at, retry_count, confirmed_by, confirmed_at, executed_by, executed_at, execution_note, draft_hash FROM workspace_effects WHERE tenant_id = ? ${caseId ? "AND case_id = ?" : ""} ORDER BY rowid`).all(...(caseId ? [tenantId, caseId] : [tenantId])) as Array<any>;
    try { return rows.map(row => ({ id: row.id, tenantId: row.tenant_id, caseId: row.case_id, kind: row.kind,
      payload: JSON.parse(row.payload), status: row.status, requestedBy: row.requested_by,
      requestedAt: row.requested_at, retryCount: row.retry_count ?? 0, ...(row.confirmed_by ? { confirmedBy: row.confirmed_by } : {}), ...(row.confirmed_at ? { confirmedAt: row.confirmed_at } : {}), ...(row.executed_by ? { executedBy: row.executed_by } : {}), ...(row.executed_at ? { executedAt: row.executed_at } : {}), ...(row.execution_note ? { executionNote: row.execution_note } : {}), draftHash: row.draft_hash }));
    } catch { return []; }
  }
  appendApproval(approval: ApprovalRecord): void {
    this.db.prepare(`INSERT INTO workspace_approvals
      (id, tenant_id, resource_id, operation, approved_by, approved_at, reason, draft_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(approval.id, approval.tenantId, approval.resourceId,
      approval.operation, approval.approvedBy, approval.approvedAt, approval.reason, approval.draftHash);
  }
  listApprovals(tenantId: string): ApprovalRecord[] {
    const rows = this.db.prepare(`SELECT id, tenant_id, resource_id, operation,
      approved_by, approved_at, reason, draft_hash FROM workspace_approvals WHERE tenant_id = ? ORDER BY rowid`).all(tenantId) as
      Array<{ id: string; tenant_id: string; resource_id: string; operation: ApprovalRecord["operation"];
        approved_by: string; approved_at: string; reason: string; draft_hash: string }>;
    return rows.map(row => ({ id: row.id, tenantId: row.tenant_id, resourceId: row.resource_id,
      operation: row.operation, approvedBy: row.approved_by, approvedAt: row.approved_at,
      reason: row.reason, draftHash: row.draft_hash }));
  }
  close(): void { this.db.close(); }
}
