import type { ResourceId } from "./resource-id.js";
import type { ResourceRecord } from "./resource.js";

export interface DerivedResourceRequest {
  parent: ResourceRecord;
  requestedPath: string;
  requestedBy: string;
  taskId?: string;
}
export interface DerivedResourceResult {
  allowed: boolean;
  reason: string;
  canonicalId?: ResourceId;
  metadata?: Record<string, unknown>;
}
export interface DerivedResourcePolicy {
  derive(request: DerivedResourceRequest): Promise<DerivedResourceResult>;
}
