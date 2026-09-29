import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ApprovalRecord, CaseAuditRecord, WorkspaceInboxRecord, WorkspacePrincipal,
  WorkspaceRepository } from "./workspace-api.js";

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
      );`);
    // Keep databases created by the previous inbox schema readable.
    try { this.db.exec("ALTER TABLE workspace_inbox ADD COLUMN version INTEGER NOT NULL DEFAULT 0"); } catch {}
    try { this.db.exec("ALTER TABLE workspace_inbox ADD COLUMN updated_at TEXT"); } catch {}
  }
  provisionSession(token: string, principal: WorkspacePrincipal): void {
    this.db.prepare(`INSERT OR REPLACE INTO workspace_sessions
      (token, user_id, tenant_id, role) VALUES (?, ?, ?, ?)`).run(token,
      principal.userId, principal.tenantId, principal.role);
  }
  findSession(token: string): WorkspacePrincipal | null {
    const row = this.db.prepare(`SELECT user_id, tenant_id, role FROM workspace_sessions WHERE token = ?`).get(token) as
      { user_id: string; tenant_id: string; role: WorkspacePrincipal["role"] } | undefined;
    return row ? { userId: row.user_id, tenantId: row.tenant_id, role: row.role } : null;
  }
  listInbox(tenantId: string): WorkspaceInboxRecord[] {
    const rows = this.db.prepare(`SELECT id, tenant_id, state, summary, version, updated_at FROM workspace_inbox
      WHERE tenant_id = ? ORDER BY rowid`).all(tenantId) as Array<{ id: string; tenant_id: string;
        state: WorkspaceInboxRecord["state"]; summary: string; version: number; updated_at: string | null }>;
    return rows.map(row => ({ id: row.id, tenantId: row.tenant_id, state: row.state, summary: row.summary,
      version: row.version, ...(row.updated_at ? { updatedAt: row.updated_at } : {}) }));
  }
  appendInbox(record: WorkspaceInboxRecord): void {
    this.db.prepare(`INSERT OR REPLACE INTO workspace_inbox
      (id, tenant_id, state, summary, version, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(record.id, record.tenantId,
      record.state, record.summary, record.version ?? 0, record.updatedAt ?? null);
  }
  updateInbox(record: WorkspaceInboxRecord): void { this.appendInbox(record); }
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
