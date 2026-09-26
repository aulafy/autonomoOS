import type { AuthorityLeaseCheck, AuthorityLeaseValidator } from "./authority-lease-validator.js";
import type { Clock } from "./clock.js";
import { validateFence } from "./fencing.js";
import type { ResourceLeaseStore } from "./resource-lease-store.js";
import type { LeaseDecision } from "./reasons.js";

export interface LeaseCommitCheck extends AuthorityLeaseCheck {
  requireResourceLease?: boolean;
  fencingToken?: number;
}

// Read-only pre-commit check. The eventual executor must still enforce the fence atomically.
export class LeaseCommitGate {
  constructor(
    private readonly authority: AuthorityLeaseValidator,
    private readonly resources: ResourceLeaseStore,
    private readonly clock: Clock
  ) {}
  check(request: LeaseCommitCheck): LeaseDecision {
    const authority = this.authority.validate(request);
    if (!authority.allowed) return authority;
    if (!request.requireResourceLease) return { allowed: true };
    if (request.fencingToken === undefined) {
      return { allowed: false, reason: "RESOURCE_LEASE_REQUIRED" };
    }
    return validateFence(this.resources, this.clock, {
      resourceId: request.resourceId,
      holderPrincipalId: request.subjectPrincipalId,
      taskId: request.taskId,
      fencingToken: request.fencingToken
    });
  }
}
