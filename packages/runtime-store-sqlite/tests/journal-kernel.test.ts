import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryBudgetLedger } from "@agent-world/budgets";
import { InMemoryContractStore } from "@agent-world/contracts";
import { InMemoryDataFlowStore, InMemoryTaskWorkingSetStore } from "@agent-world/information-flow";
import { InMemoryResourceLeaseStore } from "@agent-world/leases";
import { InMemoryResourceRegistry, mintResourceId } from "@agent-world/resources";
import { JournalKernel, ReplayClock, RuntimeDatabase } from "../src/index.js";

function temporary<T>(run: (path: string) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-h1-journal-"));
  return run(join(directory, "runtime.db"))
    .finally(() => rmSync(directory, { recursive: true, force: true }));
}

function open(path: string, liveNow: () => number) {
  const clock = new ReplayClock(liveNow);
  const database = new RuntimeDatabase(path, clock.now);
  const kernel = new JournalKernel(database, clock);
  const resources = kernel.register("resources", () => new InMemoryResourceRegistry(clock.now),
    ["register", "update"]);
  const budgets = kernel.register("budgets", () => new InMemoryBudgetLedger(clock),
    ["createBudget", "reserve", "commitReservation", "releaseReservation"]);
  const resourceLeases = kernel.register("resourceLeases",
    () => new InMemoryResourceLeaseStore(clock), ["acquire", "release", "renew", "revoke"]);
  const contracts = kernel.register("contracts", () => new InMemoryContractStore(),
    ["create", "markStatus"]);
  const objects = kernel.register("objects", () => new InMemoryDataFlowStore(),
    ["addSource", "derive"]);
  const workingSet = kernel.register("workingSet", () => new InMemoryTaskWorkingSetStore(objects),
    ["add"]);
  return { database, kernel, resources, budgets, resourceLeases, contracts,
    objects, workingSet };
}

test("replays domain methods into fresh stores with time, budget and fencing intact", async () => {
  await temporary(async path => {
    let now = 100;
    const first = open(path, () => now);
    await first.kernel.restore();
    const resourceId = mintResourceId("world_place", "demo/room");
    first.resources.register({ id: resourceId, kind: "world_place", displayName: "Room",
      aliases: [], parentId: null, dataLabel: null, exclusivity: "exclusive",
      sink: null, source: "host" });
    first.budgets.createBudget({ id: "b1", ownerPrincipalId: "astra", taskId: "t1",
      ceiling: { actions: "3" } });
    first.budgets.reserve({ id: "r1", budgetId: "b1", principalId: "astra",
      taskId: "t1", effectId: "e1", amount: { actions: "1" } }, 1);
    await first.contracts.create({ id: "c1", ownerPrincipalId: "astra", taskId: "t1",
      objective: "move", acceptanceCriteria: ["at room"], forbiddenEffects: [],
      allowedResourceIds: [resourceId], maxRisk: "R1", privacyClass: "local_only",
      createdAt: now, version: 1, status: "active", metadata: {} });
    const lease = first.resourceLeases.acquire({ id: "l1", resourceId,
      holderPrincipalId: "astra", taskId: "t1", expiresAt: 200 });
    first.resourceLeases.release(lease.id, lease.version);
    first.objects.addSource({ id: "o1", taskId: "t1", label: {
      confidentiality: "secret", categories: [], jurisdictions: [],
      ownerPrincipalIds: [], releasable: false, metadata: {} }, origin: "human",
      createdAt: now, metadata: {} });
    first.workingSet.add("t1", "o1", 0);
    const registeredAt = first.resources.get(resourceId)!.registeredAt;
    first.database.close();

    now = 150;
    const second = open(path, () => now);
    await second.kernel.restore();
    assert.equal(second.kernel.isHealthy(), true);
    assert.equal(second.resources.get(resourceId)?.registeredAt, registeredAt);
    assert.equal(second.budgets.getBudget("b1")?.reserved.actions, "1");
    assert.equal((await second.contracts.get("c1"))?.status, "active");
    assert.equal(second.workingSet.get("t1").version, 1);
    assert.equal(second.objects.get("o1")?.label?.confidentiality, "secret");
    const next = second.resourceLeases.acquire({ id: "l2", resourceId,
      holderPrincipalId: "astra", taskId: "t1", expiresAt: 250 });
    assert.ok(next.fencingToken > lease.fencingToken);
    second.database.close();
  });
});

test("corrupt projection digest blocks replay and consequential writes", async () => {
  await temporary(async path => {
    const first = open(path, () => 100);
    await first.kernel.restore();
    first.budgets.createBudget({ id: "b1", ownerPrincipalId: "astra", taskId: "t1",
      ceiling: { actions: "1" } });
    first.database.db.exec("UPDATE projection_digests SET digest = 'bad' WHERE projection_name = 'budgets'");
    first.database.close();
    const second = open(path, () => 100);
    await assert.rejects(() => second.kernel.restore(), /PROJECTION_DIGEST_MISMATCH/);
    assert.equal(second.kernel.isHealthy(), false);
    assert.throws(() => second.budgets.createBudget({ id: "b2", ownerPrincipalId: "astra",
      taskId: "t1", ceiling: { actions: "1" } }), /DURABLE_KERNEL_NOT_READY/);
    second.database.close();
  });
});

test("failed multi-store transaction leaves durable log empty and fails closed locally", async () => {
  await temporary(async path => {
    const first = open(path, () => 100);
    await first.kernel.restore();
    assert.throws(() => first.kernel.transaction(() => {
      first.budgets.createBudget({ id: "b1", ownerPrincipalId: "astra",
        taskId: "t1", ceiling: { actions: "1" } });
      throw new Error("power loss before commit");
    }), /power loss/);
    assert.equal(first.kernel.isHealthy(), false);
    assert.equal(first.database.commands().length, 0);
    first.database.close();
    const reopened = open(path, () => 100);
    await reopened.kernel.restore();
    assert.equal(reopened.budgets.getBudget("b1"), null);
    reopened.database.close();
  });
});

test("one operation timestamp is used even when the wall clock advances on every read", async () => {
  await temporary(async path => {
    let tick = 100;
    const first = open(path, () => tick++);
    await first.kernel.restore();
    const resourceId = mintResourceId("world_place", "clock/room");
    const registered = first.resources.register({ id: resourceId, kind: "world_place",
      displayName: "Room", aliases: [], parentId: null, dataLabel: null,
      exclusivity: "shared", sink: null, source: "host" });
    assert.equal(first.database.commands()[0]?.occurredAt, registered.registeredAt);
    first.database.close();
    const second = open(path, () => 1000);
    await second.kernel.restore();
    assert.equal(second.resources.get(resourceId)?.registeredAt, registered.registeredAt);
    second.database.close();
  });
});
