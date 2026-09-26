import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./helpers.js";

test("history is append-only, task-scoped and versioned", () => {
  const f = fixture();
  assert.equal(f.history.currentVersion("task-1"), 0);
  const first = f.history.append(f.fact("sensitive_read"));
  assert.equal(f.history.currentVersion("task-1"), 1);
  assert.equal(f.history.currentVersion("task-2"), 0);
  assert.throws(() => f.history.append(first), /HISTORY_FACT_EXISTS/);
  f.history.append(f.fact("secret_observed", "task-2"));
  assert.equal(f.history.listByTask("task-1").length, 1);
  assert.equal(f.history.currentVersion("task-2"), 1);
  first.metadata.changed = true;
  f.history.listByTask("task-1")[0].resourceIds.length = 0;
  assert.deepEqual(f.history.get(first.id)?.metadata, {});
  assert.equal(f.history.get(first.id)?.resourceIds.length, 1);
});

test("history decision becomes stale when trusted fact is appended", () => {
  const f = fixture();
  const decision = f.engine.evaluate(f.request("send"));
  assert.equal(decision.verdict, "allow");
  assert.equal(f.engine.isCurrent(decision), true);
  f.history.append(f.fact("sensitive_read"));
  assert.equal(f.engine.isCurrent(decision), false);
  const refreshed = f.engine.evaluate(f.request("send"));
  assert.equal(refreshed.historyVersion, 1);
  assert.equal(refreshed.verdict, "require_approval");
});

test("untrusted source and malformed fact cannot enter history", () => {
  const f = fixture();
  assert.throws(() => f.history.append({ ...f.fact("sensitive_read"),
    source: "model_memory" as "trusted_control_event" }), /INVALID_HISTORY_FACT/);
});
