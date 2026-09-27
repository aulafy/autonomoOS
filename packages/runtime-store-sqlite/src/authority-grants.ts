import type { AuthorityGrantView } from "@agent-world/leases";
import { isCanonicalResourceId } from "@agent-world/resources";

/** Host-side grant facts. Leases still perform the C3 live validation. */
export class InMemoryAuthorityGrantStore {
  private readonly values = new Map<string, AuthorityGrantView>();
  create(grant: AuthorityGrantView): AuthorityGrantView {
    if (!grant.id || !grant.subjectPrincipalId || grant.version !== 1 ||
      !Number.isFinite(grant.issuedAt) || !grant.resourceIds.length || !grant.actions.length ||
      grant.resourceIds.some(id => !isCanonicalResourceId(id)) ||
      this.values.has(grant.id)) throw new Error("INVALID_AUTHORITY_GRANT");
    const stored = structuredClone(grant);
    this.values.set(stored.id, stored);
    return structuredClone(stored);
  }
  getGrant(id: string): AuthorityGrantView | null {
    const value = this.values.get(id);
    return value ? structuredClone(value) : null;
  }
  revoke(id: string, expectedVersion: number, at: number): AuthorityGrantView {
    const current = this.values.get(id);
    if (!current || current.version !== expectedVersion ||
      current.revokedAt !== undefined || !Number.isFinite(at) || at < current.issuedAt) {
      throw new Error("AUTHORITY_GRANT_REVOCATION_INVALID");
    }
    const next = { ...current, revokedAt: at, version: current.version + 1 };
    this.values.set(id, next);
    return structuredClone(next);
  }
  list(): AuthorityGrantView[] {
    return [...this.values.values()].map(value => structuredClone(value));
  }
}
