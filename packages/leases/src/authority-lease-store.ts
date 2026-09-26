import type { AuthorityLease, AuthorityLeaseStatus } from "./authority-lease.js";

export interface AuthorityLeaseStore {
  create(lease: AuthorityLease): AuthorityLease;
  get(id: string): AuthorityLease | null;
  setStatus(id: string, status: AuthorityLeaseStatus, expectedVersion: number): AuthorityLease;
}
