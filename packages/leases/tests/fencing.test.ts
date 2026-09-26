import assert from "node:assert/strict";
import test from "node:test";
import { mintResourceId } from "@agent-world/resources";
import { InMemoryResourceLeaseStore, validateFence, type Clock } from "../src/index.js";

test("fence checks current holder, task and exact expiry boundary", () => {
  let now = 100;
  const clock: Clock = { now: () => now };
  const store = new InMemoryResourceLeaseStore(clock);
  const resourceId = mintResourceId("robot", "factory/7");
  const lease = store.acquire({ id: "resource-1", resourceId,
    holderPrincipalId: "astra", taskId: "task-1", expiresAt: 150 });
  const check = { resourceId, holderPrincipalId: "astra", taskId: "task-1",
    fencingToken: lease.fencingToken };
  assert.deepEqual(validateFence(store, clock, check), { allowed: true });
  assert.deepEqual(validateFence(store, clock, { ...check, holderPrincipalId: "other" }),
    { allowed: false, reason: "SUBJECT_MISMATCH" });
  assert.deepEqual(validateFence(store, clock, { ...check, taskId: "other" }),
    { allowed: false, reason: "TASK_MISMATCH" });
  now = 150;
  assert.deepEqual(validateFence(store, clock, check),
    { allowed: false, reason: "RESOURCE_LEASE_EXPIRED" });
});

test("revoked resource lease is not a valid fence", () => {
  const clock: Clock = { now: () => 100 };
  const store = new InMemoryResourceLeaseStore(clock);
  const resourceId = mintResourceId("robot", "factory/7");
  const lease = store.acquire({ id: "resource-1", resourceId,
    holderPrincipalId: "astra", taskId: "task-1", expiresAt: 150 });
  store.revoke(lease.id, 1);
  assert.deepEqual(validateFence(store, clock, { resourceId,
    holderPrincipalId: "astra", taskId: "task-1", fencingToken: lease.fencingToken }),
  { allowed: false, reason: "RESOURCE_LEASE_REQUIRED" });
});
