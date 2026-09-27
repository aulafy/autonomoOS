import { isCanonicalResourceId } from "@agent-world/resources";
import type { AuthoritySource } from "./authority-source.js";
import type { AuthorityLease, IssueAuthorityLeaseInput } from "./authority-lease.js";
import type { AuthorityLeaseStore } from "./authority-lease-store.js";
import type { Clock } from "./clock.js";

// Host control-plane code calls this service. A grant must pre-exist in AuthoritySource.
export class AuthorityLeaseService {
  constructor(
    private readonly source: AuthoritySource,
    private readonly store: AuthorityLeaseStore,
    private readonly clock: Clock
  ) {}

  issue(input: IssueAuthorityLeaseInput): AuthorityLease {
    const now = this.clock.now();
    const grant = this.source.getGrant(input.grantId);
    if (!grant) throw new Error(`GRANT_NOT_FOUND:${input.grantId}`);
    if (grant.revokedAt !== undefined && now >= grant.revokedAt) throw new Error("GRANT_REVOKED");
    if (grant.expiresAt !== undefined && now >= grant.expiresAt) throw new Error("GRANT_EXPIRED");
    if (grant.issuedAt > now) throw new Error("GRANT_NOT_ACTIVE");
    if (input.subjectPrincipalId !== grant.subjectPrincipalId) throw new Error("SUBJECT_MISMATCH");
    if (!input.id || !input.taskId || !input.subjectPrincipalId) throw new Error("INVALID_LEASE_IDENTITY");
    if (!Number.isFinite(input.notBefore) || !Number.isFinite(input.expiresAt) ||
      input.notBefore < grant.issuedAt || input.expiresAt <= now ||
      input.expiresAt <= input.notBefore) {
      throw new Error("INVALID_LEASE_WINDOW");
    }
    if (grant.expiresAt !== undefined && input.expiresAt > grant.expiresAt) {
      throw new Error("LEASE_WIDENS_GRANT");
    }
    if (!input.resourceIds.length || !input.actions.length ||
      input.resourceIds.some(id => !isCanonicalResourceId(id) || !grant.resourceIds.includes(id)) ||
      input.actions.some(action => !action || !grant.actions.includes(action))) {
      throw new Error("LEASE_WIDENS_GRANT");
    }
    const lease: AuthorityLease = {
      id: input.id, grantId: grant.id, grantVersion: grant.version,
      subjectPrincipalId: input.subjectPrincipalId, taskId: input.taskId,
      resourceIds: [...new Set(input.resourceIds)], actions: [...new Set(input.actions)],
      issuedAt: now, notBefore: input.notBefore, expiresAt: input.expiresAt,
      status: "active", version: 1
    };
    return this.store.create(lease);
  }
}
