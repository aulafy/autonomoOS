import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryResourceRegistry, mintResourceId } from "@agent-world/resources";
import {
  AuthorityLeaseService, AuthorityLeaseValidator, InMemoryAuthorityLeaseStore,
  type AuthorityGrantView, type AuthoritySource, type Clock, type IssueAuthorityLeaseInput
} from "../src/index.js";

const robot = mintResourceId("robot", "factory/7");
const other = mintResourceId("robot", "factory/8");

function fixture() {
  let now = 100;
  const clock: Clock = { now: () => now };
  let grant: AuthorityGrantView | null = {
    id: "grant-1", version: 1, subjectPrincipalId: "astra",
    resourceIds: [robot], actions: ["move"], issuedAt: 90, expiresAt: 300
  };
  const source: AuthoritySource = { getGrant: id => id === grant?.id ? structuredClone(grant) : null };
  const store = new InMemoryAuthorityLeaseStore();
  const service = new AuthorityLeaseService(source, store, clock);
  const validator = new AuthorityLeaseValidator(source, store, clock);
  const input: IssueAuthorityLeaseInput = {
    id: "lease-1", grantId: "grant-1", subjectPrincipalId: "astra",
    taskId: "task-1", resourceIds: [robot], actions: ["move"],
    notBefore: 100, expiresAt: 200
  };
  const check = { leaseId: "lease-1", subjectPrincipalId: "astra", taskId: "task-1",
    resourceId: robot, action: "move" };
  return { clock, source, store, service, validator, input, check,
    setNow: (value: number) => { now = value; },
    setGrant: (value: AuthorityGrantView | null) => { grant = value; },
    getGrant: () => structuredClone(grant)
  };
}

test("lease issuance requires a real grant and cannot widen resources, actions, expiry or subject", () => {
  const f = fixture();
  assert.throws(() => f.service.issue({ ...f.input, grantId: "invented" }), /GRANT_NOT_FOUND/);
  assert.throws(() => f.service.issue({ ...f.input, resourceIds: [robot, other] }), /LEASE_WIDENS_GRANT/);
  assert.throws(() => f.service.issue({ ...f.input, actions: ["move", "delete"] }), /LEASE_WIDENS_GRANT/);
  assert.throws(() => f.service.issue({ ...f.input, expiresAt: 301 }), /LEASE_WIDENS_GRANT/);
  assert.throws(() => f.service.issue({ ...f.input, subjectPrincipalId: "other" }), /SUBJECT_MISMATCH/);
  const issued = f.service.issue(f.input);
  assert.equal(issued.grantVersion, 1);
  assert.deepEqual(f.validator.validate(f.check), { allowed: true });
});

test("wrong principal, task, action and resource are denied", () => {
  const f = fixture();
  f.service.issue(f.input);
  assert.deepEqual(f.validator.validate({ ...f.check, subjectPrincipalId: "other" }),
    { allowed: false, reason: "SUBJECT_MISMATCH" });
  assert.deepEqual(f.validator.validate({ ...f.check, taskId: "other" }),
    { allowed: false, reason: "TASK_MISMATCH" });
  assert.deepEqual(f.validator.validate({ ...f.check, action: "delete" }),
    { allowed: false, reason: "ACTION_OUT_OF_SCOPE" });
  assert.deepEqual(f.validator.validate({ ...f.check, resourceId: other }),
    { allowed: false, reason: "RESOURCE_OUT_OF_SCOPE" });
});

test("future notBefore and exact expiry boundary are denied", () => {
  const f = fixture();
  f.service.issue({ ...f.input, notBefore: 120 });
  assert.deepEqual(f.validator.validate(f.check), { allowed: false, reason: "LEASE_NOT_ACTIVE" });
  f.setNow(120);
  assert.deepEqual(f.validator.validate(f.check), { allowed: true });
  f.setNow(200);
  assert.deepEqual(f.validator.validate(f.check), { allowed: false, reason: "LEASE_EXPIRED" });
});

test("revoked lease and stale caller copy cannot override current store", () => {
  const f = fixture();
  const callerCopy = f.service.issue(f.input);
  f.store.setStatus(callerCopy.id, "revoked", callerCopy.version);
  assert.equal(callerCopy.status, "active");
  assert.deepEqual(f.validator.validate(f.check), { allowed: false, reason: "LEASE_REVOKED" });
  assert.throws(() => f.store.setStatus(callerCopy.id, "active", 1), /LEASE_VERSION_CONFLICT/);
});

test("grant revocation, expiry, removal and version changes are checked live", () => {
  const f = fixture();
  f.service.issue(f.input);
  const original = f.getGrant()!;
  f.setGrant({ ...original, revokedAt: 100 });
  assert.deepEqual(f.validator.validate(f.check), { allowed: false, reason: "GRANT_REVOKED" });
  f.setGrant({ ...original, expiresAt: 100 });
  assert.deepEqual(f.validator.validate(f.check), { allowed: false, reason: "GRANT_EXPIRED" });
  f.setGrant({ ...original, version: 2 });
  assert.deepEqual(f.validator.validate(f.check), { allowed: false, reason: "GRANT_CHANGED" });
  f.setGrant(null);
  assert.deepEqual(f.validator.validate(f.check), { allowed: false, reason: "GRANT_NOT_FOUND" });
});

test("resource ownership cannot substitute for a grant", () => {
  const registry = new InMemoryResourceRegistry();
  registry.register({ id: robot, kind: "robot", displayName: "Robot 7", aliases: [],
    parentId: null, ownerPrincipalId: "astra", dataLabel: null,
    exclusivity: "exclusive", sink: null, source: "host" });
  assert.equal(registry.get(robot)?.ownerPrincipalId, "astra");
  const f = fixture();
  f.setGrant(null);
  assert.throws(() => f.service.issue(f.input), /GRANT_NOT_FOUND/);
});

test("authority store returns defensive copies and checks optimistic version", () => {
  const f = fixture();
  const issued = f.service.issue(f.input);
  issued.resourceIds.push(other);
  const read = f.store.get(issued.id)!;
  assert.deepEqual(read.resourceIds, [robot]);
  read.actions.push("delete");
  assert.deepEqual(f.store.get(issued.id)?.actions, ["move"]);
  f.store.setStatus(issued.id, "suspended", 1);
  assert.throws(() => f.store.setStatus(issued.id, "revoked", 1), /LEASE_VERSION_CONFLICT/);
});
