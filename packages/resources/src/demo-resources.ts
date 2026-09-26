import { mintResourceId } from "./resource-id.js";
import type { RegisterResourceInput } from "./resource.js";
import type { ResourceRegistry } from "./resource-registry.js";

export function createDemoResources(registry: ResourceRegistry, now = Date.now()): void {
  const worldId = mintResourceId("world", "demo-office");
  const shared = {
    parentId: null, dataLabel: null, exclusivity: "shared", sink: null,
    source: "host", metadata: {}, registeredAt: now, updatedAt: now
  } as const;
  const add = (input: RegisterResourceInput) => registry.register(input);
  add({ ...shared, id: worldId, kind: "world", displayName: "Demo Office",
    aliases: ["office", "demo office"] });
  for (const [path, name, legacyId, aliases] of [
    ["meeting-room", "Meeting Room", "meeting_room", ["meeting room", "meeting_room"]],
    ["home-point", "Home Point", "home_point", ["home", "home point", "home_point"]]
  ] as const) {
    add({ ...shared, id: mintResourceId("world_place", `demo-office/${path}`),
      kind: "world_place", displayName: name, aliases: [...aliases], parentId: worldId,
      source: "world_adapter", metadata: { legacyWorldEntityId: legacyId } });
  }
  add({ ...shared, id: mintResourceId("agent", "astra"), kind: "agent",
    displayName: "Astra", aliases: ["astra"], metadata: { legacyWorldEntityId: "astra" } });
  add({ ...shared, id: mintResourceId("directory", "workspace"), kind: "directory",
    displayName: "Agent World Workspace", aliases: ["workspace", "agent world workspace"],
    dataLabel: { sensitivity: "internal", categories: ["user_workspace"],
      source: "host", classifiedAt: now }, source: "filesystem_resolver",
    metadata: { logicalRoot: "~/AgentWorldWorkspace" } });
  for (const [path, name, aliases, sideEffect] of [
    ["filesystem.read", "Filesystem Read", ["filesystem.read", "read file", "read workspace file"], "none"],
    ["filesystem.write", "Filesystem Write", ["filesystem.write", "write file", "write workspace file"], "local_reversible"]
  ] as const) {
    add({ ...shared, id: mintResourceId("tool", path), kind: "tool", displayName: name,
      aliases: [...aliases], metadata: { sideEffect } });
  }
  add({ ...shared, id: mintResourceId("sink_email", "demo/external-email"),
    kind: "sink_email", displayName: "Demo External Email",
    aliases: ["external email", "demo email"],
    sink: { external: true, trustClass: "external", destination: "email",
      allowedSensitivity: ["public", "internal"] } });
}
