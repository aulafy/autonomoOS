import type { ResourceId, ResourceRegistry } from "@agent-world/resources";
import type { DataFlowStore } from "./data-flow-store.js";
import { FlowError, type DataCategory, type DataObjectRef } from "./types.js";

const CATEGORIES = new Set<DataCategory>(["generic", "personal_data", "credential",
  "financial", "health", "source_code", "customer_data", "proprietary", "regulated",
  "security_sensitive"]);

/** Host adapter: source labels come from C2 records, never model supplied text. */
export class DataObjectCompiler {
  constructor(private readonly resources: ResourceRegistry, private readonly objects: DataFlowStore) {}

  fromResource(id: string, taskId: string, resourceId: ResourceId, createdAt: number,
    releasable: boolean): DataObjectRef {
    const resource = this.resources.get(resourceId);
    if (!resource) throw new FlowError("RESOURCE_NOT_FOUND");
    const label = resource.dataLabel ? {
      confidentiality: resource.dataLabel.sensitivity,
      categories: resource.dataLabel.categories.filter((category): category is DataCategory =>
        CATEGORIES.has(category as DataCategory)),
      jurisdictions: [], ownerPrincipalIds: resource.ownerPrincipalId ? [resource.ownerPrincipalId] : [],
      releasable, metadata: { resourceGeneration: resource.generation,
        classificationSource: resource.dataLabel.source }
    } : null;
    return this.objects.addSource({ id, taskId, resourceId, label,
      origin: "resource", createdAt, metadata: { resourceGeneration: resource.generation } });
  }
}
