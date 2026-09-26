import type { ResourceKind } from "./kinds.js";
import type { ResourceId } from "./resource-id.js";
import type { ResourceRecord } from "./resource.js";
import type { ResourceResolver } from "./resource-resolver.js";

export interface ResourceScope {
  allowedResourceIds: ResourceId[];
  allowedKinds?: ResourceKind[];
}
export class ResourceScopeGuard {
  constructor(private readonly scope: ResourceScope) {}
  allows(resource: ResourceRecord): boolean {
    return (!this.scope.allowedKinds || this.scope.allowedKinds.includes(resource.kind)) &&
      this.scope.allowedResourceIds.includes(resource.id);
  }
}
export function compileResourceScope(resolver: ResourceResolver, requestedNames: readonly string[]): ResourceId[] {
  const result: ResourceId[] = [];
  for (const name of requestedNames) {
    const resolved = resolver.resolve(name);
    if (!resolved.ok) throw new Error(`contract_resource_resolution_failed:${name}:${resolved.reason}`);
    result.push(resolved.resource.id);
  }
  return [...new Set(result)];
}
