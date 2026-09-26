import assert from "node:assert/strict";
import test from "node:test";
import { mintResourceId } from "@agent-world/resources";
import {
  AuthorityLeaseService, AuthorityLeaseValidator, InMemoryAuthorityLeaseStore,
  InMemoryResourceLeaseStore, LeaseCommitGate, validateFence,
  type AuthorityGrantView, type AuthoritySource, type Clock
} from "../src/index.js";

const robot = mintResourceId("robot", "factory/7");

function fixture() {
  let now = 100;
  const clock: Clock = { now: () => now };
  const store = new InMemoryResourceLeaseStore(clock);
  const acquire = (id: string, holderPrincipalId = "astra", expiresAt = 150) =>
    store.acquire({ id, resourceId: robot, holderPrincipalId,
      taskId: "task-1", expiresAt });
  return { clock, store, acquire, setNow: (value: number) => { now = value; } };
}

test("exclusive acquisition blocks a second holder", () => {
  const f = fixture();
  f.acquire("resource-1");
  assert.throws(() => f.acquire("resource-2", "other"), /RESOURCE_BUSY/);
});

test("expiry allows reacquisition with a higher fence and rejects stale fence", () => {
  const f = fixture();
  const old = f.acquire("resource-1");
  f.setNow(150);
  const next = f.acquire("resource-2", "other", 200);
  assert.equal(next.fencingToken, old.fencingToken + 1);
  assert.deepEqual(validateFence(f.store, f.clock, {
    resourceId: robot, holderPrincipalId: "astra", taskId: "task-1",
    fencingToken: old.fencingToken
  }), { allowed: false, reason: "FENCE_STALE" });
  assert.deepEqual(validateFence(f.store, f.clock, {
    resourceId: robot, holderPrincipalId: "other", taskId: "task-1",
    fencingToken: next.fencingToken
  }), { allowed: true });
});

test("release permits new acquisition and never reuses its fence", () => {
  const f = fixture();
  const old = f.acquire("resource-1");
  f.store.release(old.id, old.version);
  const next = f.acquire("resource-2");
  assert.ok(next.fencingToken > old.fencingToken);
  assert.throws(() => f.store.renew(old.id, 2, 250), /FENCE_STALE/);
});

test("renewal retains fence and checks version and expiry", () => {
  const f = fixture();
  const first = f.acquire("resource-1");
  const renewed = f.store.renew(first.id, 1, 200);
  assert.equal(renewed.fencingToken, first.fencingToken);
  assert.equal(renewed.version, 2);
  assert.throws(() => f.store.renew(first.id, 1, 250), /RESOURCE_LEASE_VERSION_CONFLICT/);
  f.setNow(200);
  assert.throws(() => f.store.renew(first.id, 2, 250), /RESOURCE_LEASE_EXPIRED/);
});

test("resource store returns defensive copies", () => {
  const f = fixture();
  const first = f.acquire("resource-1");
  first.status = "released";
  const read = f.store.get(first.id)!;
  assert.equal(read.status, "active");
  read.holderPrincipalId = "other";
  assert.equal(f.store.getCurrent(robot)?.holderPrincipalId, "astra");
});

test("commit gate requires both live authority and matching resource fence", () => {
  const f = fixture();
  let grant: AuthorityGrantView = {
    id: "grant-1", version: 1, subjectPrincipalId: "astra", resourceIds: [robot],
    actions: ["move"], issuedAt: 90, expiresAt: 300
  };
  const source: AuthoritySource = { getGrant: id => id === grant.id ? structuredClone(grant) : null };
  const authorityStore = new InMemoryAuthorityLeaseStore();
  new AuthorityLeaseService(source, authorityStore, f.clock).issue({
    id: "authority-1", grantId: "grant-1", subjectPrincipalId: "astra",
    taskId: "task-1", resourceIds: [robot], actions: ["move"],
    notBefore: 100, expiresAt: 200
  });
  const gate = new LeaseCommitGate(
    new AuthorityLeaseValidator(source, authorityStore, f.clock), f.store, f.clock
  );
  const check = { leaseId: "authority-1", subjectPrincipalId: "astra", taskId: "task-1",
    action: "move", resourceId: robot, requireResourceLease: true,
    fencingToken: 1 };
  assert.deepEqual(gate.check(check), { allowed: false, reason: "RESOURCE_LEASE_REQUIRED" });
  const resource = f.acquire("resource-1");
  assert.deepEqual(gate.check({ ...check, fencingToken: resource.fencingToken }), { allowed: true });
  assert.deepEqual(gate.check({ ...check, fencingToken: 0 }),
    { allowed: false, reason: "FENCE_STALE" });
  grant = { ...grant, version: 2 };
  assert.deepEqual(gate.check({ ...check, fencingToken: resource.fencingToken }),
    { allowed: false, reason: "GRANT_CHANGED" });
});
