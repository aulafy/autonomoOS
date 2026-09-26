import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryResourceRegistry, ResourceResolver, ResourceScopeGuard,
  compileResourceScope, createDemoResources, isCanonicalResourceId,
  mintResourceId, parseResourceId, registerLegacyWorldEntity,
  type RegisterResourceInput
} from "../src/index.js";

function record(path: string, overrides: Partial<RegisterResourceInput> = {}): RegisterResourceInput {
  return {
    id: mintResourceId("world_place", path), kind: "world_place",
    displayName: path, aliases: [], parentId: null, dataLabel: null,
    exclusivity: "shared", sink: null, source: "host", ...overrides
  };
}

test("valid canonical IDs and forbidden segments", () => {
  assert.equal(parseResourceId("place:demo-office/meeting-room"), "place:demo-office/meeting-room");
  for (const value of ["meeting_room", "PLACE:demo", "file:workspace/../secret",
    "file:workspace//secret", "foo:bar", "file:/absolute", "file:workspace/./a"]) {
    assert.equal(isCanonicalResourceId(value), false, value);
  }
});

test("invented canonical ID is NOT_REGISTERED and malformed ID is INVALID_ID", () => {
  const resolver = new ResourceResolver(new InMemoryResourceRegistry());
  assert.deepEqual(resolver.resolve("file:workspace/secrets/ssh-key"), {
    ok: false, reason: "NOT_REGISTERED", input: "file:workspace/secrets/ssh-key"
  });
  assert.equal(resolver.resolve("FILE:workspace/readme").ok, false);
  assert.deepEqual(resolver.resolve("FILE:workspace/readme"), {
    ok: false, reason: "INVALID_ID", input: "FILE:workspace/readme"
  });
});

test("alias normalization and expected kind", () => {
  const registry = new InMemoryResourceRegistry();
  registry.register(record("room", { displayName: "Meeting Room", aliases: ["  Meeting   Room  "] }));
  const resolver = new ResourceResolver(registry);
  assert.equal(resolver.resolve(" meeting room ").ok, true);
  assert.deepEqual(resolver.resolve("Meeting Room", { expectedKinds: ["tool"] }), {
    ok: false, reason: "NOT_FOUND", input: "Meeting Room"
  });
  assert.deepEqual(resolver.resolve("place:room", { expectedKinds: ["tool"] }), {
    ok: false, reason: "KIND_MISMATCH", input: "place:room", candidates: ["place:room"]
  });
});

test("duplicate canonical IDs reject; duplicate aliases fail closed", () => {
  const registry = new InMemoryResourceRegistry();
  registry.register(record("first", { displayName: "Room" }));
  assert.throws(() => registry.register(record("first")), /resource_already_registered/);
  registry.register(record("second", { displayName: "Room" }));
  assert.deepEqual(new ResourceResolver(registry).resolve("room"), {
    ok: false, reason: "AMBIGUOUS", input: "room",
    candidates: ["place:first", "place:second"]
  });
});

test("parent integrity and kind matching", () => {
  const registry = new InMemoryResourceRegistry();
  assert.throws(() => registry.register(record("child", {
    parentId: mintResourceId("world", "missing")
  })), /parent_resource_not_registered/);
  assert.throws(() => registry.register(record("child", { kind: "file" })), /kind_id_mismatch/);
});

test("reads and writes are defensive copies, including nested metadata", () => {
  const registry = new InMemoryResourceRegistry();
  const input = record("room", { metadata: { nested: { a: 1 } },
    dataLabel: { sensitivity: "internal", categories: ["a"], source: "host", classifiedAt: 1 } });
  const created = registry.register(input);
  (input.metadata!.nested as { a: number }).a = 2;
  (created.metadata.nested as { a: number }).a = 3;
  created.dataLabel!.categories.push("b");
  const read = registry.get(created.id)!;
  assert.deepEqual(read.metadata, { nested: { a: 1 } });
  assert.deepEqual(read.dataLabel?.categories, ["a"]);
  (registry.list()[0].metadata.nested as { a: number }).a = 4;
  assert.deepEqual(registry.get(created.id)?.metadata, { nested: { a: 1 } });
});

test("optimistic version and generation regression", () => {
  const registry = new InMemoryResourceRegistry();
  const input = record("room");
  registry.register(input);
  const next = registry.update({ ...input, generation: 2 }, 1);
  assert.equal(next.version, 2);
  assert.equal(next.generation, 2);
  assert.throws(() => registry.update(input, 1), /resource_version_conflict/);
  assert.throws(() => registry.update({ ...input, generation: 1 }, 2), /resource_generation_regression/);
  assert.equal(registry.registryGeneration(), 2);
});

test("updates reindex aliases and reject parent cycles", () => {
  const registry = new InMemoryResourceRegistry();
  const parent = record("parent", { displayName: "Old Name" });
  const child = record("child", { parentId: parent.id });
  registry.register(parent);
  registry.register(child);
  registry.update({ ...parent, displayName: "New Name" }, 1);
  const resolver = new ResourceResolver(registry);
  assert.deepEqual(resolver.resolve("Old Name"), {
    ok: false, reason: "NOT_FOUND", input: "Old Name"
  });
  assert.equal(resolver.resolve("New Name").ok, true);
  assert.throws(() => registry.update({ ...parent, parentId: child.id }, 2), /resource_parent_cycle/);
});

test("data labels and sink metadata remain host records", () => {
  const registry = new InMemoryResourceRegistry();
  const id = mintResourceId("sink_email", "demo/outbound");
  registry.register({ id, kind: "sink_email", displayName: "Outbound",
    aliases: [], parentId: null, exclusivity: "shared", source: "host",
    dataLabel: { sensitivity: "restricted", categories: ["personal"], source: "host", classifiedAt: 1 },
    sink: { external: true, trustClass: "external", allowedSensitivity: ["public"] } });
  const read = registry.get(id)!;
  read.sink!.allowedSensitivity.push("secret");
  assert.deepEqual(registry.get(id)?.sink?.allowedSensitivity, ["public"]);
  assert.equal(registry.get(id)?.dataLabel?.sensitivity, "restricted");
});

test("contract scope compiles aliases to canonical IDs and rejects ambiguity", () => {
  const registry = new InMemoryResourceRegistry();
  createDemoResources(registry, 1);
  const resolver = new ResourceResolver(registry);
  assert.deepEqual(compileResourceScope(resolver, ["Meeting Room", "meeting_room"]),
    ["place:demo-office/meeting-room"]);
  assert.throws(() => compileResourceScope(resolver, ["Invented"]), /NOT_FOUND/);
  registry.register(record("other/meeting-room", { displayName: "Meeting Room" }));
  assert.throws(() => compileResourceScope(resolver, ["Meeting Room"]), /AMBIGUOUS/);
});

test("scope guard returns OUT_OF_SCOPE semantics by denying unlisted resource", () => {
  const registry = new InMemoryResourceRegistry();
  createDemoResources(registry);
  const guard = new ResourceScopeGuard({
    allowedResourceIds: [mintResourceId("world_place", "demo-office/meeting-room")]
  });
  assert.equal(guard.allows(registry.get(mintResourceId("world_place", "demo-office/home-point"))!), false);
  assert.equal(guard.allows(registry.get(mintResourceId("world_place", "demo-office/meeting-room"))!), true);
});

test("legacy adapter maps world IDs without making them canonical", () => {
  const registry = new InMemoryResourceRegistry();
  registry.register({ id: mintResourceId("world", "demo-office"), kind: "world",
    displayName: "Demo Office", aliases: [], parentId: null, dataLabel: null,
    exclusivity: "shared", sink: null, source: "host" });
  const room = registerLegacyWorldEntity(registry, "demo-office", {
    id: "meeting_room", kind: "space", displayName: "Meeting Room"
  });
  const agent = registerLegacyWorldEntity(registry, "demo-office", {
    id: "astra", kind: "agent", displayName: "Astra"
  });
  assert.equal(room.id, "place:demo-office/meeting-room");
  assert.equal(agent.id, "agent:astra");
  assert.equal(room.metadata.legacyWorldEntityId, "meeting_room");
  assert.equal(new ResourceResolver(registry).resolve("meeting_room").ok, true);
  assert.equal(isCanonicalResourceId("meeting_room"), false);
});
