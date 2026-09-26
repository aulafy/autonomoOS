import type { ResourceId } from "@agent-world/resources";
import type { AuthoritySource } from "./authority-source.js";
import type { AuthorityLeaseStore } from "./authority-lease-store.js";
import type { Clock } from "./clock.js";
import type { LeaseDecision } from "./reasons.js";

export interface AuthorityLeaseCheck {
  leaseId: string;
  subjectPrincipalId: string;
  taskId: string;
  action: string;
  resourceId: ResourceId;
}

export class AuthorityLeaseValidator {
  constructor(
    private readonly source: AuthoritySource,
    private readonly store: AuthorityLeaseStore,
    private readonly clock: Clock
  ) {}

  validate(check: AuthorityLeaseCheck): LeaseDecision {
    // Always fetch the current store state. A planner-held lease object is never evidence.
    const lease = this.store.get(check.leaseId);
    if (!lease) return { allowed: false, reason: "LEASE_NOT_FOUND" };
    if (lease.status === "revoked") return { allowed: false, reason: "LEASE_REVOKED" };
    if (lease.status !== "active") return { allowed: false, reason: "LEASE_NOT_ACTIVE" };
    const now = this.clock.now();
    if (now < lease.notBefore) return { allowed: false, reason: "LEASE_NOT_ACTIVE" };
    if (now >= lease.expiresAt) return { allowed: false, reason: "LEASE_EXPIRED" };
    const grant = this.source.getGrant(lease.grantId);
    if (!grant) return { allowed: false, reason: "GRANT_NOT_FOUND" };
    if (grant.revokedAt !== undefined && now >= grant.revokedAt) {
      return { allowed: false, reason: "GRANT_REVOKED" };
    }
    if (grant.expiresAt !== undefined && now >= grant.expiresAt) {
      return { allowed: false, reason: "GRANT_EXPIRED" };
    }
    if (grant.version !== lease.grantVersion) return { allowed: false, reason: "GRANT_CHANGED" };
    if (grant.subjectPrincipalId !== lease.subjectPrincipalId) {
      return { allowed: false, reason: "SUBJECT_MISMATCH" };
    }
    if (lease.resourceIds.some(id => !grant.resourceIds.includes(id)) ||
      lease.actions.some(action => !grant.actions.includes(action))) {
      return { allowed: false, reason: "LEASE_WIDENS_GRANT" };
    }
    if (lease.subjectPrincipalId !== check.subjectPrincipalId) {
      return { allowed: false, reason: "SUBJECT_MISMATCH" };
    }
    if (lease.taskId !== check.taskId) return { allowed: false, reason: "TASK_MISMATCH" };
    if (!lease.actions.includes(check.action)) return { allowed: false, reason: "ACTION_OUT_OF_SCOPE" };
    if (!lease.resourceIds.includes(check.resourceId)) {
      return { allowed: false, reason: "RESOURCE_OUT_OF_SCOPE" };
    }
    return { allowed: true };
  }
}
