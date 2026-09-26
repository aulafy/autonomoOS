import type { AuthorityLease, AuthorityLeaseStatus } from "./authority-lease.js";
import type { AuthorityLeaseStore } from "./authority-lease-store.js";

export class InMemoryAuthorityLeaseStore implements AuthorityLeaseStore {
  private readonly byId = new Map<string, AuthorityLease>();
  create(lease: AuthorityLease): AuthorityLease {
    if (this.byId.has(lease.id)) throw new Error(`LEASE_ALREADY_EXISTS:${lease.id}`);
    if (lease.version !== 1 || lease.status !== "active") throw new Error("INVALID_INITIAL_LEASE_STATE");
    const stored = structuredClone(lease);
    this.byId.set(lease.id, stored);
    return structuredClone(stored);
  }
  get(id: string): AuthorityLease | null {
    const lease = this.byId.get(id);
    return lease ? structuredClone(lease) : null;
  }
  setStatus(id: string, status: AuthorityLeaseStatus, expectedVersion: number): AuthorityLease {
    const current = this.byId.get(id);
    if (!current) throw new Error(`LEASE_NOT_FOUND:${id}`);
    if (current.version !== expectedVersion) throw new Error(`LEASE_VERSION_CONFLICT:${id}`);
    if (current.status === "revoked" || current.status === "expired") {
      throw new Error(`LEASE_TERMINAL:${id}`);
    }
    const next = { ...current, status, version: current.version + 1 };
    this.byId.set(id, next);
    return structuredClone(next);
  }
}
