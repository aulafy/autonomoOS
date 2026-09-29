import { createApproval, requirePermission, type ApprovalRecord,
  type WorkspacePrincipal, type WorkspaceRole } from "./workspace-policy.js";

export interface WorkspaceInboxRecord {
  id: string;
  tenantId: string;
  state: "received" | "pending_review" | "approved";
  summary: string;
}

export interface WorkspaceApiRequest {
  method: "GET" | "POST";
  path: string;
  authorization?: string;
  body?: unknown;
}

export interface WorkspaceApiResponse {
  status: 200 | 201 | 400 | 401 | 403 | 404;
  body: Record<string, unknown>;
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
  private readonly sessions = new Map<string, WorkspacePrincipal>();
  private readonly inbox = new Map<string, WorkspaceInboxRecord[]>();
  private readonly approvals: ApprovalRecord[] = [];

  addSession(token: string, principal: WorkspacePrincipal): void {
    if (!token || token.length < 16) throw new Error("INVALID_SESSION_TOKEN");
    this.sessions.set(token, structuredClone(principal));
  }

  addInbox(record: WorkspaceInboxRecord): void {
    const records = this.inbox.get(record.tenantId) ?? [];
    this.inbox.set(record.tenantId, [...records, structuredClone(record)]);
  }

  approvalsForTenant(tenantId: string): ApprovalRecord[] {
    return this.approvals.filter(approval => approval.tenantId === tenantId)
      .map(approval => structuredClone(approval));
  }

  handle(request: WorkspaceApiRequest): WorkspaceApiResponse {
    const token = tokenFrom(request);
    const principal = token ? this.sessions.get(token) : undefined;
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
      return { status: 200, body: { tenantId, items: structuredClone(this.inbox.get(tenantId) ?? []) } };
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
        const approval = createApproval({ id: `approval-${this.approvals.length + 1}`,
          principal, resource: { tenantId, id: input.resourceId }, operation: "approveOffer",
          approvedAt: input.approvedAt, reason: input.reason, draftHash: input.draftHash });
        this.approvals.push(approval);
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
