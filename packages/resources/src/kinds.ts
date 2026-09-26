export const RESOURCE_KINDS = [
  "world", "world_place", "entity", "robot", "file", "directory",
  "workspace", "tool", "service", "wallet", "compute", "gpu",
  "machine", "network_origin", "credential", "dataset", "sink_email",
  "sink_http", "human_queue", "agent"
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const RESOURCE_PREFIX_BY_KIND: Record<ResourceKind, string> = {
  world: "world", world_place: "place", entity: "entity", robot: "robot",
  file: "file", directory: "dir", workspace: "workspace", tool: "tool",
  service: "service", wallet: "wallet", compute: "compute", gpu: "gpu",
  machine: "machine", network_origin: "origin", credential: "credential",
  dataset: "dataset", sink_email: "sink-email", sink_http: "sink-http",
  human_queue: "human", agent: "agent"
};

export const RESOURCE_KIND_BY_PREFIX: Readonly<Record<string, ResourceKind>> =
  Object.freeze(Object.fromEntries(
    Object.entries(RESOURCE_PREFIX_BY_KIND).map(([kind, prefix]) =>
      [prefix, kind as ResourceKind]
    )
  ));
