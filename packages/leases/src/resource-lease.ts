import type { ResourceId } from "@agent-world/resources";

export type ResourceLeaseStatus = "active" | "released" | "revoked" | "expired";
export interface ResourceLease {
  id: string;
  resourceId: ResourceId;
  holderPrincipalId: string;
  taskId: string;
  fencingToken: number;
  acquiredAt: number;
  expiresAt: number;
  status: ResourceLeaseStatus;
  version: number;
}
export interface AcquireResourceLeaseInput {
  id: string;
  resourceId: ResourceId;
  holderPrincipalId: string;
  taskId: string;
  expiresAt: number;
}
