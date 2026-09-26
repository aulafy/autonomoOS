import assert from "node:assert/strict";
import test from "node:test";
import { WorldRuntime } from "@agent-world/world-core";
import { createDemoControlPlane } from "../src/demo-control-plane.js";

test("M5 world side effects pass through C11 and completion uses observations", async () => {
  const world = new WorldRuntime();
  world.addEntity({ id: "astra", kind: "agent", name: "Astra", state: {}, affordances: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } });
  world.addEntity({ id: "meeting_room", kind: "space", name: "Meeting Room", state: {},
    affordances: [], transform: { position: [4, 0, -2], rotation: [0, 0, 0, 1] } });
  const eventTypes: string[] = [];
  const governance = createDemoControlPlane(world, event => {
    eventTypes.push(event.type === "control.event"
      ? String(event.payload.controlEventType) : event.type);
  });
  assert.equal(await governance.mayComplete("task-1"), false);
  const goto = await governance.run({ id: "intent-1", actorId: "astra", action: "goto",
    targetId: "meeting_room", parameters: {}, provenance: { source: "model" } },
  "task-1", "task-1");
  assert.equal(goto.status, "completed");
  assert.deepEqual(world.getEntity("astra")?.transform?.position, [4, 0, -2]);
  assert.deepEqual(eventTypes.slice(0, 5), ["effect.prepared", "effect.dispatching",
    "agent.moved", "effect.dispatch_reported", "effect.committed"]);
  assert.equal(await governance.mayComplete("task-1"), true);
  const second = await governance.run({ id: "intent-3", actorId: "astra", action: "goto",
    targetId: "meeting_room", parameters: {}, provenance: { source: "model" } },
  "task-1", "task-1");
  assert.equal(second.status, "completed");
  assert.equal(await governance.mayComplete("task-1"), true);
  const denied = await governance.run({ id: "intent-2", actorId: "astra",
    action: "purchase_compute", parameters: { units: 1 },
    provenance: { source: "model" } }, "task-1", "task-1");
  assert.equal(denied.status, "denied");
  assert.equal(eventTypes.filter(type => type === "effect.dispatching").length, 2);
});

test("host emergency stop blocks world dispatch before the executor", async () => {
  const world = new WorldRuntime();
  world.addEntity({ id: "astra", kind: "agent", name: "Astra", state: {}, affordances: [],
    transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } });
  world.addEntity({ id: "meeting_room", kind: "space", name: "Meeting Room", state: {},
    affordances: [], transform: { position: [4, 0, -2], rotation: [0, 0, 0, 1] } });
  const events: string[] = [];
  const governance = createDemoControlPlane(world, event => events.push(event.type));
  governance.activateEmergencyStop("operator stop");
  const result = await governance.run({ id: "intent-1", actorId: "astra", action: "goto",
    targetId: "meeting_room", parameters: {}, provenance: { source: "model" } },
  "task-1", "task-1");
  assert.equal(result.status, "denied");
  assert.deepEqual(world.getEntity("astra")?.transform?.position, [0, 0, 0]);
  assert.equal(events.includes("agent.moved"), false);
});
