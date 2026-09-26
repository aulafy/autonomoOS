import type { ResourceId } from "@agent-world/resources";
import type { Clock } from "./clock.js";
import type { ResourceLeaseStore } from "./resource-lease-store.js";
import type { LeaseDecision } from "./reasons.js";

export interface FenceCheck {
  resourceId: ResourceId;
  holderPrincipalId: string;
  taskId: string;
  fencingToken: number;
}
export function validateFence(store: ResourceLeaseStore, clock: Clock, check: FenceCheck): LeaseDecision {
  const current = store.getCurrent(check.resourceId);
  if (!current || current.status !== "active") {
    return { allowed: false, reason: "RESOURCE_LEASE_REQUIRED" };
  }
  if (clock.now() >= current.expiresAt) {
    return { allowed: false, reason: "RESOURCE_LEASE_EXPIRED" };
  }
  if (current.fencingToken !== check.fencingToken) {
    return { allowed: false, reason: "FENCE_STALE" };
  }
  if (current.holderPrincipalId !== check.holderPrincipalId) {
    return { allowed: false, reason: "SUBJECT_MISMATCH" };
  }
  if (current.taskId !== check.taskId) return { allowed: false, reason: "TASK_MISMATCH" };
  return { allowed: true };
}
