import assert from "node:assert/strict";
import test from "node:test";
import { fixture, label, emailSink, publicSink } from "./helpers.js";

test("release approval matches exact task, intent, object, sink and version", () => {
  const f = fixture();
  f.add("confidential", label("confidential"));
  f.add("other", label("confidential"));
  f.approvals.append({ id: "approval-1", taskId: "task-1", intentId: "intent-1",
    objectIds: ["confidential"], sinkId: emailSink, workingSetVersion: 2,
    issuedAt: 90, expiresAt: 110, issuerId: "human-1" });
  assert.equal(f.engine.evaluate(f.request(["confidential"]), "approval-1").verdict, "allow");
  assert.equal(f.engine.evaluate(f.request(["other"]), "approval-1").verdict,
    "require_release_approval");
  assert.equal(f.engine.evaluate(f.request(["confidential"], publicSink), "approval-1").verdict,
    "require_release_approval");
  assert.equal(f.engine.evaluate(f.request(["confidential"], emailSink, "task-1", "intent-2"),
    "approval-1").verdict, "require_release_approval");
  f.setNow(110);
  assert.equal(f.engine.evaluate(f.request(["confidential"]), "approval-1").verdict,
    "require_release_approval");
});

test("hard deny cannot be overridden and version change invalidates approval", () => {
  const f = fixture();
  f.add("secret", label("secret"));
  f.approvals.append({ id: "approval-1", taskId: "task-1", intentId: "intent-1",
    objectIds: ["secret"], sinkId: emailSink, workingSetVersion: 1,
    issuedAt: 90, expiresAt: 200, issuerId: "human-1" });
  assert.equal(f.engine.evaluate(f.request(["secret"]), "approval-1").verdict, "deny");
  f.add("new", label("public"));
  assert.equal(f.engine.evaluate(f.request(["secret"]), "approval-1").verdict, "deny");
});

test("approval store is append-only and defensive", () => {
  const f = fixture();
  const input = { id: "approval-1", taskId: "task-1", intentId: "intent-1",
    objectIds: ["object-1"], sinkId: emailSink, workingSetVersion: 1,
    issuedAt: 90, expiresAt: 200, issuerId: "human-1" };
  f.approvals.append(input);
  assert.throws(() => f.approvals.append(input), /RELEASE_APPROVAL_EXISTS/);
  f.approvals.get("approval-1")!.objectIds.length = 0;
  assert.deepEqual(f.approvals.get("approval-1")?.objectIds, ["object-1"]);
});
