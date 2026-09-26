import { isCanonicalResourceId } from "@agent-world/resources";
import { FlowError, type DataReleaseApproval, type FlowRequest } from "./types.js";

export class InMemoryReleaseApprovalStore {
  private readonly approvals = new Map<string, DataReleaseApproval>();
  append(approval: DataReleaseApproval): DataReleaseApproval {
    if (!approval?.id || !approval.taskId || !approval.intentId || !approval.issuerId ||
      !isCanonicalResourceId(approval.sinkId) ||
      !Array.isArray(approval.objectIds) || !approval.objectIds.length ||
      new Set(approval.objectIds).size !== approval.objectIds.length ||
      !Number.isSafeInteger(approval.workingSetVersion) || approval.workingSetVersion < 0 ||
      !Number.isFinite(approval.issuedAt) || !Number.isFinite(approval.expiresAt) ||
      approval.expiresAt <= approval.issuedAt) throw new FlowError("INVALID_RELEASE_APPROVAL");
    if (this.approvals.has(approval.id)) throw new FlowError("RELEASE_APPROVAL_EXISTS");
    const stored = structuredClone(approval);
    this.approvals.set(stored.id, stored);
    return structuredClone(stored);
  }
  get(id: string): DataReleaseApproval | null {
    const value = this.approvals.get(id);
    return value ? structuredClone(value) : null;
  }
  listByTask(taskId: string): readonly DataReleaseApproval[] {
    return [...this.approvals.values()].filter(value => value.taskId === taskId)
      .map(value => structuredClone(value));
  }
}

export function releaseApprovalMatches(approval: DataReleaseApproval, request: FlowRequest,
  version: number, now: number): boolean {
  const sorted = (ids: readonly string[]) => [...ids].sort().join("\u0000");
  return approval.taskId === request.taskId && approval.intentId === request.intentId &&
    approval.sinkId === request.sinkId &&
    sorted(approval.objectIds) === sorted(request.objectIds) &&
    approval.workingSetVersion === version && approval.issuedAt <= now && now < approval.expiresAt;
}
