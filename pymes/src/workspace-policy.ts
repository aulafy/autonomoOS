export type WorkspaceRole = "owner" | "agent" | "reviewer";
export type WorkspaceOperation = "readInbox" | "prepareQuote" | "approveOffer" |
  "executeEffect" | "manageConnectors" | "manageMembers" | "exportData";

const permissions: Record<WorkspaceRole, ReadonlySet<WorkspaceOperation>> = {
  owner: new Set(["readInbox", "prepareQuote", "approveOffer", "executeEffect",
    "manageConnectors", "manageMembers", "exportData"]),
  agent: new Set(["readInbox", "prepareQuote", "manageConnectors"]),
  reviewer: new Set(["readInbox", "approveOffer", "exportData"])
};

export interface WorkspacePrincipal {
  userId: string;
  tenantId: string;
  role: WorkspaceRole;
}

export interface WorkspaceResource {
  tenantId: string;
  id: string;
}

export function can(principal: WorkspacePrincipal, operation: WorkspaceOperation,
  resource: WorkspaceResource): boolean {
  return Boolean(principal.userId && principal.tenantId &&
    principal.tenantId === resource.tenantId && permissions[principal.role].has(operation));
}

export function requirePermission(principal: WorkspacePrincipal,
  operation: WorkspaceOperation, resource: WorkspaceResource): void {
  if (!can(principal, operation, resource)) throw new Error("WORKSPACE_PERMISSION_DENIED");
}

export interface ApprovalRecord {
  id: string;
  tenantId: string;
  resourceId: string;
  operation: "approveOffer" | "executeEffect";
  approvedBy: string;
  approvedAt: string;
  reason: string;
  draftHash: string;
}

export function createApproval(input: {
  id: string;
  principal: WorkspacePrincipal;
  resource: WorkspaceResource;
  operation: ApprovalRecord["operation"];
  approvedAt: string;
  reason: string;
  draftHash: string;
}): ApprovalRecord {
  requirePermission(input.principal, input.operation, input.resource);
  if (!input.id || !input.draftHash || input.reason.trim().length < 5 ||
    Number.isNaN(Date.parse(input.approvedAt))) throw new Error("INVALID_APPROVAL");
  return { id: input.id, tenantId: input.resource.tenantId, resourceId: input.resource.id,
    operation: input.operation, approvedBy: input.principal.userId,
    approvedAt: input.approvedAt, reason: input.reason.trim(), draftHash: input.draftHash };
}
