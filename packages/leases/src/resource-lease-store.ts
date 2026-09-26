import type { ResourceId } from "@agent-world/resources";
import type { AcquireResourceLeaseInput, ResourceLease } from "./resource-lease.js";

export interface ResourceLeaseStore {
  acquire(input: AcquireResourceLeaseInput): ResourceLease;
  renew(id: string, expectedVersion: number, expiresAt: number): ResourceLease;
  release(id: string, expectedVersion: number): ResourceLease;
  revoke(id: string, expectedVersion: number): ResourceLease;
  get(id: string): ResourceLease | null;
  getCurrent(resourceId: ResourceId): ResourceLease | null;
}
