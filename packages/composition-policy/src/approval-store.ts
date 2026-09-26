import { isCanonicalResourceId } from "@agent-world/resources";
import { CompositionError, type Approval, type CompositionCandidate } from "./types.js";

export interface ApprovalStore {
  append(approval: Approval): Approval;
  get(id: string): Approval | null;
  listByTask(taskId: string): readonly Approval[];
}

export class InMemoryApprovalStore implements ApprovalStore {
  private readonly approvals = new Map<string, Approval>();

  append(approval: Approval): Approval {
    if (!approval?.id || !approval.taskId || !approval.intentId || !approval.actionType ||
      !approval.issuerId || !Number.isSafeInteger(approval.historyVersion) ||
      approval.historyVersion < 0 || !Number.isFinite(approval.issuedAt) ||
      !Number.isFinite(approval.expiresAt) || approval.expiresAt <= approval.issuedAt ||
      !Array.isArray(approval.resourceIds) ||
      approval.resourceIds.some(id => !isCanonicalResourceId(id)) ||
      new Set(approval.resourceIds).size !== approval.resourceIds.length ||
      (approval.sinkId !== undefined && !approval.resourceIds.includes(approval.sinkId))) {
      throw new CompositionError("INVALID_APPROVAL");
    }
    if (this.approvals.has(approval.id)) throw new CompositionError("APPROVAL_EXISTS");
    const stored = structuredClone(approval);
    this.approvals.set(stored.id, stored);
    return structuredClone(stored);
  }
  get(id: string): Approval | null {
    const approval = this.approvals.get(id);
    return approval ? structuredClone(approval) : null;
  }
  listByTask(taskId: string): readonly Approval[] {
    return [...this.approvals.values()].filter(a => a.taskId === taskId)
      .map(a => structuredClone(a));
  }
}

export function approvalMatches(approval: Approval, candidate: CompositionCandidate,
  historyVersion: number, now: number): boolean {
  const sorted = (ids: readonly string[]) => [...ids].sort().join("\u0000");
  return approval.taskId === candidate.taskId && approval.intentId === candidate.intentId &&
    approval.actionType === candidate.actionType && approval.sinkId === candidate.sinkId &&
    sorted(approval.resourceIds) === sorted(candidate.resourceIds) &&
    approval.historyVersion === historyVersion && approval.issuedAt <= now && now < approval.expiresAt;
}
