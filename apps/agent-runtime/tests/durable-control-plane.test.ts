import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { WorldRuntime } from "@agent-world/world-core";
import { createDurableDomainStores, JournalKernel, ReplayClock,
  RuntimeDatabase } from "@agent-world/runtime-store-sqlite";
import { createDemoControlPlane } from "../src/demo-control-plane.js";

function world(): WorldRuntime {
  const value = new WorldRuntime();
  value.addEntity({ id: "astra", kind: "agent", name: "Astra", state: {},
    affordances: [], transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } });
  value.addEntity({ id: "meeting_room", kind: "space", name: "Meeting Room",
    state: {}, affordances: [], transform: { position: [4, 0, -2],
      rotation: [0, 0, 0, 1] } });
  return value;
}

test("durable demo control plane reopens task, effect and grant before another action", async () => {
  const directory = mkdtempSync(join(tmpdir(), "h1-demo-"));
  const path = join(directory, "runtime.db");
  try {
    async function open() {
      const clock = new ReplayClock();
      const database = new RuntimeDatabase(path, clock.now);
      const kernel = new JournalKernel(database, clock);
      const stores = createDurableDomainStores(kernel);
      await kernel.restore();
      const control = createDemoControlPlane(world(), event =>
        database.appendRuntimeEvent(event), { kernel, stores });
      control.recoverOnStartup();
      return { database, stores, control };
    }
    const first = await open();
    const intent = { id: "intent-1", actorId: "astra", action: "goto" as const,
      targetId: "meeting_room", parameters: {},
      provenance: { source: "model" as const } };
    const result = await first.control.run(intent, "task-1", "task-1");
    assert.equal(result.status, "completed");
    assert.equal(await first.control.mayComplete("task-1"), true);
    first.database.close();

    const second = await open();
    assert.equal(second.stores.tasks.get("task-1")?.requiredEffectIds[0], result.effectId);
    assert.equal(second.stores.effects.get(result.effectId!)?.status, "committed");
    assert.ok(second.stores.grants.getGrant("grant:task-1"));
    assert.equal(await second.control.mayComplete("task-1"), true);
    second.database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("fresh process recovers an integrated C11 dispatch marker without calling world executor", async () => {
  const directory = mkdtempSync(join(tmpdir(), "h1-c11-crash-"));
  const path = join(directory, "runtime.db");
  try {
    const fixture = fileURLToPath(new URL("./fixtures/kill-after-dispatch.ts", import.meta.url));
    const child = spawnSync(process.execPath, ["--import", "tsx", fixture, path], {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      encoding: "utf8", timeout: 15000 });
    assert.equal(child.signal, "SIGKILL", child.stderr);
    const clock = new ReplayClock();
    const database = new RuntimeDatabase(path, clock.now);
    const kernel = new JournalKernel(database, clock);
    const stores = createDurableDomainStores(kernel);
    await kernel.restore();
    assert.equal(stores.effects.list().length, 1);
    assert.equal(stores.effects.list()[0]?.status, "dispatching");
    assert.equal(stores.budgets.listReservations()[0]?.status, "active");
    assert.equal(database.runtimeEvents().filter(event => event.type === "agent.moved").length, 0);
    const control = createDemoControlPlane(world(), event =>
      database.appendRuntimeEvent(event), { kernel, stores });
    control.recoverOnStartup();
    assert.equal(stores.effects.list()[0]?.status, "unknown");
    assert.equal(stores.budgets.listReservations()[0]?.status, "active");
    assert.equal(stores.reconciliations.list().length, 1);
    assert.equal(database.runtimeEvents().filter(event => event.type === "agent.moved").length, 0);
    database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
