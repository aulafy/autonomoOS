import { isCanonicalResourceId, type ResourceId } from "@agent-world/resources";
import type { Clock } from "./clock.js";
import type { AcquireResourceLeaseInput, ResourceLease, ResourceLeaseStatus } from "./resource-lease.js";
import type { ResourceLeaseStore } from "./resource-lease-store.js";

export class InMemoryResourceLeaseStore implements ResourceLeaseStore {
  private readonly byId = new Map<string, ResourceLease>();
  private readonly currentId = new Map<ResourceId, string>();
  private readonly lastFence = new Map<ResourceId, number>();
  constructor(private readonly clock: Clock) {}

  acquire(input: AcquireResourceLeaseInput): ResourceLease {
    const now = this.clock.now();
    if (!input.id || !input.holderPrincipalId || !input.taskId || !isCanonicalResourceId(input.resourceId)) {
      throw new Error("INVALID_RESOURCE_LEASE_IDENTITY");
    }
    if (this.byId.has(input.id)) throw new Error(`RESOURCE_LEASE_ALREADY_EXISTS:${input.id}`);
    if (!Number.isFinite(input.expiresAt) || input.expiresAt <= now) {
      throw new Error("INVALID_RESOURCE_LEASE_WINDOW");
    }
    const current = this.getCurrent(input.resourceId);
    if (current?.status === "active" && now < current.expiresAt) throw new Error("RESOURCE_BUSY");
    const nextFence = (this.lastFence.get(input.resourceId) ?? 0) + 1;
    if (!Number.isSafeInteger(nextFence)) throw new Error("FENCE_EXHAUSTED");
    const lease: ResourceLease = {
      id: input.id, resourceId: input.resourceId,
      holderPrincipalId: input.holderPrincipalId, taskId: input.taskId,
      fencingToken: nextFence, acquiredAt: now, expiresAt: input.expiresAt,
      status: "active", version: 1
    };
    this.byId.set(lease.id, lease);
    this.currentId.set(lease.resourceId, lease.id);
    this.lastFence.set(lease.resourceId, nextFence);
    return structuredClone(lease);
  }

  renew(id: string, expectedVersion: number, expiresAt: number): ResourceLease {
    const current = this.requireCurrent(id, expectedVersion);
    const now = this.clock.now();
    if (current.status !== "active" || now >= current.expiresAt) throw new Error("RESOURCE_LEASE_EXPIRED");
    if (!Number.isFinite(expiresAt) || expiresAt <= current.expiresAt) {
      throw new Error("INVALID_RESOURCE_LEASE_RENEWAL");
    }
    return this.replace(current, { ...current, expiresAt, version: current.version + 1 });
  }

  release(id: string, expectedVersion: number): ResourceLease {
    return this.changeStatus(id, expectedVersion, "released");
  }
  revoke(id: string, expectedVersion: number): ResourceLease {
    return this.changeStatus(id, expectedVersion, "revoked");
  }
  get(id: string): ResourceLease | null {
    const lease = this.byId.get(id);
    return lease ? structuredClone(lease) : null;
  }
  getCurrent(resourceId: ResourceId): ResourceLease | null {
    const id = this.currentId.get(resourceId);
    return id ? this.get(id) : null;
  }

  private changeStatus(id: string, expectedVersion: number, status: ResourceLeaseStatus): ResourceLease {
    const current = this.requireCurrent(id, expectedVersion);
    if (current.status !== "active") throw new Error("RESOURCE_LEASE_NOT_ACTIVE");
    return this.replace(current, { ...current, status, version: current.version + 1 });
  }
  private requireCurrent(id: string, expectedVersion: number): ResourceLease {
    const current = this.byId.get(id);
    if (!current) throw new Error(`RESOURCE_LEASE_NOT_FOUND:${id}`);
    if (current.version !== expectedVersion) throw new Error(`RESOURCE_LEASE_VERSION_CONFLICT:${id}`);
    if (this.currentId.get(current.resourceId) !== id) throw new Error("FENCE_STALE");
    return current;
  }
  private replace(current: ResourceLease, next: ResourceLease): ResourceLease {
    this.byId.set(current.id, next);
    return structuredClone(next);
  }
}
