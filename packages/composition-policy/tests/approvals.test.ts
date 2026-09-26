import assert from "node:assert/strict";
import test from "node:test";
import { fixture, sinkId, unknownSinkId } from "./helpers.js";

test("approval is exact scoped, expiring and does not grant authority", () => {
  const f = fixture();
  f.history.append(f.fact("sensitive_read"));
  const approval = f.approvals.append({ id: "approval-1", taskId: "task-1", intentId: "intent-1",
    actionType: "send", resourceIds: [sinkId], sinkId, historyVersion: 1,
    issuedAt: 90, expiresAt: 110, issuerId: "human-1" });
  assert.equal(f.engine.evaluate(f.request("send"), approval.id).verdict, "allow");
  assert.equal(f.engine.evaluate(f.request("send", "task-1", "intent-2"), approval.id).verdict,
    "require_approval");
  assert.equal(f.engine.evaluate({ ...f.request("send"), resourceIds: [unknownSinkId],
    sinkId: unknownSinkId }, approval.id).verdict, "require_approval");
  f.setNow(110);
  assert.equal(f.engine.evaluate(f.request("send"), approval.id).verdict, "require_approval");
  approval.resourceIds.length = 0;
  assert.deepEqual(f.approvals.get("approval-1")?.resourceIds, [sinkId]);
});

test("approval cannot override hard deny or survive new history version", () => {
  const f = fixture();
  f.history.append(f.fact("secret_observed"));
  f.approvals.append({ id: "approval-1", taskId: "task-1", intentId: "intent-1",
    actionType: "publish", resourceIds: [sinkId], sinkId, historyVersion: 1,
    issuedAt: 90, expiresAt: 200, issuerId: "human-1" });
  assert.equal(f.engine.evaluate(f.request("publish"), "approval-1").verdict, "deny");
  f.history.append(f.fact("sensitive_read"));
  assert.equal(f.engine.evaluate(f.request("publish"), "approval-1").verdict, "deny");
  assert.equal(f.history.currentVersion("task-1"), 2);
});

test("approval store rejects duplicate IDs and returns defensive copies", () => {
  const f = fixture();
  const input = { id: "approval-1", taskId: "task-1", intentId: "intent-1",
    actionType: "send", resourceIds: [sinkId], sinkId, historyVersion: 0,
    issuedAt: 90, expiresAt: 200, issuerId: "human-1" };
  f.approvals.append(input);
  assert.throws(() => f.approvals.append(input), /APPROVAL_EXISTS/);
  f.approvals.listByTask("task-1")[0].resourceIds.length = 0;
  assert.deepEqual(f.approvals.get("approval-1")?.resourceIds, [sinkId]);
});
