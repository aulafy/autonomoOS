import { mintResourceId } from "./resource-id.js";
import type { ResourceRecord } from "./resource.js";
import type { ResourceRegistry } from "./resource-registry.js";

export interface LegacyWorldEntity {
  id: string;
  kind: string;
  displayName?: string;
}
function slugLegacyId(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-").replace(/\s+/g, "-");
}
export function registerLegacyWorldEntity(
  registry: ResourceRegistry, worldId: string, entity: LegacyWorldEntity
): ResourceRecord {
  const agent = entity.kind === "agent";
  const parentId = agent ? null : mintResourceId("world", worldId);
  if (parentId && !registry.has(parentId)) {
    throw new Error(`world_resource_not_registered:${parentId}`);
  }
  const id = agent
    ? mintResourceId("agent", slugLegacyId(entity.id))
    : mintResourceId("world_place", `${worldId}/${slugLegacyId(entity.id)}`);
  const existing = registry.get(id);
  if (existing) return existing;
  return registry.register({
    id, kind: agent ? "agent" : "world_place",
    displayName: entity.displayName ?? entity.id,
    aliases: [entity.id, entity.id.replace(/_/g, " ")], parentId,
    dataLabel: null, exclusivity: "shared", sink: null,
    source: "world_adapter", metadata: { legacyWorldEntityId: entity.id }
  });
}
