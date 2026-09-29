import { createApproval, requirePermission, type ApprovalRecord,
  type WorkspacePrincipal, type WorkspaceRole } from "./workspace-policy.js";
import { ingestOpenClawIntoWorkspace } from "./workspace-ingress.js";
import { transitionCase, type CaseState } from "./case-lifecycle.js";
import { createPendingEffect, type EffectKind, type PendingEffect } from "./effects.js";
import type { OpenClawEnterpriseEnvelope, OpenClawEnterprisePolicy } from "./openclaw-gateway.js";
export type { ApprovalRecord, WorkspacePrincipal } from "./workspace-policy.js";

export interface WorkspaceInboxRecord {
  id: string;
  tenantId: string;
  state: CaseState;
  summary: string;
  version?: number;
  updatedAt?: string;
}
export interface CaseAuditRecord {
  id: string; tenantId: string; caseId: string; from: CaseState; to: CaseState;
  operation: string; actorId: string; at: string; version: number;
}

export interface WorkspaceApiRequest {
  method: "GET" | "POST";
  path: string;
  authorization?: string;
  ingressToken?: string;
  body?: unknown;
}

export interface WorkspaceApiResponse {
  status: 200 | 201 | 400 | 401 | 403 | 404;
  body: Record<string, unknown>;
}

export interface WorkspaceRepository {
  findSession(token: string): WorkspacePrincipal | null;
  listInbox(tenantId: string): WorkspaceInboxRecord[];
  appendInbox(record: WorkspaceInboxRecord): void;
  updateInbox(record: WorkspaceInboxRecord): void;
  appendCaseAudit(record: CaseAuditRecord): void;
  listCaseAudit(tenantId: string, caseId: string): CaseAuditRecord[];
  appendEffect(effect: PendingEffect): void;
  updateEffect(effect: PendingEffect): void;
  listEffects(tenantId: string, caseId?: string): PendingEffect[];
  appendApproval(approval: ApprovalRecord): void;
  listApprovals(tenantId: string): ApprovalRecord[];
}

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private readonly sessions = new Map<string, WorkspacePrincipal>();
  private readonly inbox = new Map<string, WorkspaceInboxRecord[]>();
  private readonly approvals: ApprovalRecord[] = [];
  addSession(token: string, principal: WorkspacePrincipal): void {
    this.sessions.set(token, structuredClone(principal));
  }
  findSession(token: string): WorkspacePrincipal | null {
    const value = this.sessions.get(token);
    return value ? structuredClone(value) : null;
  }
  listInbox(tenantId: string): WorkspaceInboxRecord[] {
    return structuredClone(this.inbox.get(tenantId) ?? []);
  }
  appendInbox(record: WorkspaceInboxRecord): void {
    const records = this.inbox.get(record.tenantId) ?? [];
    this.inbox.set(record.tenantId, [...records, structuredClone(record)]);
  }
  updateInbox(record: WorkspaceInboxRecord): void { this.appendInbox(record); }
  private readonly audits: CaseAuditRecord[] = [];
  appendCaseAudit(record: CaseAuditRecord): void { this.audits.push(structuredClone(record)); }
  listCaseAudit(tenantId: string, caseId: string): CaseAuditRecord[] {
    return this.audits.filter(value => value.tenantId === tenantId && value.caseId === caseId).map(value => structuredClone(value));
  }
  private readonly effects: PendingEffect[] = [];
  appendEffect(effect: PendingEffect): void { this.effects.push(structuredClone(effect)); }
  updateEffect(effect: PendingEffect): void { const index = this.effects.findIndex(v => v.id === effect.id && v.tenantId === effect.tenantId); if (index >= 0) this.effects[index] = structuredClone(effect); }
  listEffects(tenantId: string, caseId?: string): PendingEffect[] { return this.effects.filter(v => v.tenantId === tenantId && (!caseId || v.caseId === caseId)).map(v => structuredClone(v)); }
  appendApproval(approval: ApprovalRecord): void { this.approvals.push(structuredClone(approval)); }
  listApprovals(tenantId: string): ApprovalRecord[] {
    return this.approvals.filter(value => value.tenantId === tenantId)
      .map(value => structuredClone(value));
  }
}

interface ApprovalBody {
  resourceId: string;
  reason: string;
  draftHash: string;
  approvedAt: string;
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function pathParts(path: string): string[] | null {
  const parts = path.split("/").filter(Boolean);
  return parts.length ? parts : null;
}

function tokenFrom(request: WorkspaceApiRequest): string | null {
  const value = request.authorization;
  return value?.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

/**
 * Small HTTP contract for the first PYMES server. It owns authorization and
 * response shaping; persistence can be replaced without changing callers.
 */
export class WorkspaceApi {
  constructor(readonly repository: WorkspaceRepository = new InMemoryWorkspaceRepository(),
    private readonly ingress?: { token: string; policy: OpenClawEnterprisePolicy }) {}

  addSession(token: string, principal: WorkspacePrincipal): void {
    if (!token || token.length < 16) throw new Error("INVALID_SESSION_TOKEN");
    if (this.repository instanceof InMemoryWorkspaceRepository) this.repository.addSession(token, principal);
    else throw new Error("SESSION_PROVISIONING_REQUIRES_REPOSITORY_OWNER");
  }

  addInbox(record: WorkspaceInboxRecord): void {
    this.repository.appendInbox(record);
  }

  approvalsForTenant(tenantId: string): ApprovalRecord[] {
    return this.repository.listApprovals(tenantId);
  }

  handle(request: WorkspaceApiRequest): WorkspaceApiResponse {
    const ingressParts = pathParts(request.path);
    if (request.method === "POST" && ingressParts?.[0] === "v1" &&
      ingressParts[1] === "workspaces" && ingressParts[3] === "ingress" &&
      ingressParts[4] === "openclaw" && ingressParts.length === 5) {
      const tenantId = ingressParts[2];
      if (!this.ingress || request.ingressToken !== this.ingress.token || tenantId !== this.ingress.policy.tenantId) {
        return { status: 401, body: { error: "INGRESS_UNAUTHORIZED" } };
      }
      const result = ingestOpenClawIntoWorkspace({
        envelope: request.body as OpenClawEnterpriseEnvelope,
        policy: this.ingress.policy,
        repository: this.repository
      });
      if (result.accepted) return { status: 201, body: result.record as unknown as Record<string, unknown> };
      return { status: result.reason === "DUPLICATE_EVENT" ? 400 : 400, body: { error: result.reason } };
    }
    const token = tokenFrom(request);
    const principal = token ? this.repository.findSession(token) : null;
    if (!principal) return { status: 401, body: { error: "UNAUTHENTICATED" } };
    const parts = pathParts(request.path);
    if (!parts || parts[0] !== "v1" || parts[1] !== "workspaces") {
      return { status: 404, body: { error: "NOT_FOUND" } };
    }
    const tenantId = parts[2];
    if (!tenantId || tenantId !== principal.tenantId) {
      return { status: 403, body: { error: "TENANT_SCOPE_DENIED" } };
    }
    const resource = { tenantId, id: tenantId };
    if (request.method === "GET" && parts[3] === "inbox" && parts.length === 4) {
      try { requirePermission(principal, "readInbox", resource); }
      catch { return { status: 403, body: { error: "WORKSPACE_PERMISSION_DENIED" } }; }
      return { status: 200, body: { tenantId, items: this.repository.listInbox(tenantId) } };
    }
    if (request.method === "GET" && parts[3] === "approvals" && parts.length === 4) {
      try { requirePermission(principal, "readInbox", resource); }
      catch { return { status: 403, body: { error: "WORKSPACE_PERMISSION_DENIED" } }; }
      return { status: 200, body: { tenantId, approvals: this.repository.listApprovals(tenantId) } };
    }
    if (request.method === "POST" && parts[3] === "cases" && parts[5] === "transition" && parts.length === 6) {
      const body = jsonRecord(request.body);
      if (!body || typeof body.to !== "string" || typeof body.at !== "string")
        return { status: 400, body: { error: "INVALID_CASE_TRANSITION_BODY" } };
      const item = this.repository.listInbox(tenantId).find(value => value.id === parts[4]);
      if (!item) return { status: 404, body: { error: "CASE_NOT_FOUND" } };
      try {
        const next = transitionCase({ current: { id: item.id, tenantId, state: item.state,
          version: item.version ?? 0, updatedAt: item.updatedAt ?? new Date(0).toISOString() },
          to: body.to as CaseState, principal, at: body.at });
        this.repository.updateInbox({ ...item, state: next.state, version: next.version, updatedAt: next.updatedAt });
        this.repository.appendCaseAudit({ id: `audit-${tenantId}-${item.id}-${next.version}`, tenantId,
          caseId: item.id, from: item.state, to: next.state, operation: "transition", actorId: principal.userId,
          at: next.updatedAt, version: next.version });
        return { status: 200, body: next as unknown as Record<string, unknown> };
      } catch (error) {
        const message = error instanceof Error ? error.message : "INVALID_CASE_TRANSITION";
        return { status: message === "WORKSPACE_PERMISSION_DENIED" ? 403 : 400, body: { error: message } };
      }
    }
    if (request.method === "GET" && parts[3] === "cases" && parts[5] === "audit" && parts.length === 6) {
      try { requirePermission(principal, "readInbox", { tenantId, id: parts[4] }); }
      catch { return { status: 403, body: { error: "WORKSPACE_PERMISSION_DENIED" } }; }
      return { status: 200, body: { tenantId, caseId: parts[4], audit: this.repository.listCaseAudit(tenantId, parts[4]) } };
    }
    if (request.method === "GET" && parts[3] === "effects" && parts.length === 4) {
      try { requirePermission(principal, "readInbox", resource); } catch { return { status: 403, body: { error: "WORKSPACE_PERMISSION_DENIED" } }; }
      return { status: 200, body: { tenantId, effects: this.repository.listEffects(tenantId) } };
    }
    if (request.method === "POST" && parts[3] === "effects" && parts.length === 4) {
      const body = jsonRecord(request.body);
      if (!body || typeof body.id !== "string" || typeof body.caseId !== "string" || typeof body.kind !== "string" || typeof body.requestedAt !== "string" || typeof body.draftHash !== "string" || jsonRecord(body.payload) === null)
        return { status: 400, body: { error: "INVALID_EFFECT_BODY" } };
      try {
        const effect = createPendingEffect({ id: body.id, tenantId, caseId: body.caseId, kind: body.kind as EffectKind,
          payload: jsonRecord(body.payload)!, principal, requestedAt: body.requestedAt, draftHash: body.draftHash });
        this.repository.appendEffect(effect);
        return { status: 201, body: effect as unknown as Record<string, unknown> };
      } catch (error) { const message = error instanceof Error ? error.message : "INVALID_PENDING_EFFECT"; return { status: message === "WORKSPACE_PERMISSION_DENIED" ? 403 : 400, body: { error: message } }; }
    }
    if (request.method === "POST" && parts[3] === "effects" && parts[5] === "confirm" && parts.length === 6) {
      const body = jsonRecord(request.body);
      if (!body || body.confirm !== true || typeof body.confirmedAt !== "string") return { status: 400, body: { error: "EXPLICIT_CONFIRMATION_REQUIRED" } };
      const effect = this.repository.listEffects(tenantId).find(value => value.id === parts[4]);
      if (!effect) return { status: 404, body: { error: "EFFECT_NOT_FOUND" } };
      try {
        requirePermission(principal, "executeEffect", { tenantId, id: effect.caseId });
        if (effect.status !== "pending" || Number.isNaN(Date.parse(body.confirmedAt))) throw new Error("EFFECT_NOT_PENDING");
        const confirmed = { ...effect, status: "confirmed" as const, confirmedBy: principal.userId, confirmedAt: body.confirmedAt };
        this.repository.updateEffect(confirmed);
        return { status: 200, body: confirmed as unknown as Record<string, unknown> };
      } catch (error) { const message = error instanceof Error ? error.message : "EFFECT_CONFIRMATION_FAILED"; return { status: message === "WORKSPACE_PERMISSION_DENIED" ? 403 : 400, body: { error: message } }; }
    }
    if (request.method === "POST" && parts[3] === "effects" && parts[5] === "result" && parts.length === 6) {
      const body = jsonRecord(request.body);
      if (!body || (body.result !== "succeeded" && body.result !== "failed") || typeof body.executedAt !== "string" || typeof body.note !== "string") return { status: 400, body: { error: "INVALID_EFFECT_RESULT" } };
      const effect = this.repository.listEffects(tenantId).find(value => value.id === parts[4]);
      if (!effect) return { status: 404, body: { error: "EFFECT_NOT_FOUND" } };
      try {
        requirePermission(principal, "executeEffect", { tenantId, id: effect.caseId });
        if (effect.status !== "confirmed" || Number.isNaN(Date.parse(body.executedAt)) || body.note.trim().length < 3) throw new Error("EFFECT_NOT_CONFIRMED");
        const result = { ...effect, status: body.result as "succeeded" | "failed", executedBy: principal.userId, executedAt: body.executedAt, executionNote: body.note.trim() };
        this.repository.updateEffect(result);
        return { status: 200, body: result as unknown as Record<string, unknown> };
      } catch (error) { const message = error instanceof Error ? error.message : "EFFECT_RESULT_FAILED"; return { status: message === "WORKSPACE_PERMISSION_DENIED" ? 403 : 400, body: { error: message } }; }
    }
    if (request.method === "POST" && parts[3] === "approvals" && parts.length === 4) {
      const body = jsonRecord(request.body);
      if (!body || typeof body.resourceId !== "string" || typeof body.reason !== "string" ||
        typeof body.draftHash !== "string" || typeof body.approvedAt !== "string") {
        return { status: 400, body: { error: "INVALID_APPROVAL_BODY" } };
      }
      const input: ApprovalBody = { resourceId: body.resourceId, reason: body.reason,
        draftHash: body.draftHash, approvedAt: body.approvedAt };
      try {
        const approval = createApproval({ id: `approval-${this.repository.listApprovals(tenantId).length + 1}`,
          principal, resource: { tenantId, id: input.resourceId }, operation: "approveOffer",
          approvedAt: input.approvedAt, reason: input.reason, draftHash: input.draftHash });
        this.repository.appendApproval(approval);
        return { status: 201, body: structuredClone(approval) as unknown as Record<string, unknown> };
      } catch (error) {
        return { status: error instanceof Error && error.message === "WORKSPACE_PERMISSION_DENIED" ? 403 : 400,
          body: { error: error instanceof Error ? error.message : "INVALID_APPROVAL" } };
      }
    }
    return { status: 404, body: { error: "NOT_FOUND" } };
  }
}

export const supportedRoles: readonly WorkspaceRole[] = ["owner", "agent", "reviewer"];
