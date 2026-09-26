import assert from "node:assert/strict";
import test from "node:test";
import { CompositionEngine, defaultCompositionRules } from "../src/index.js";
import { fixture, unknownSinkId } from "./helpers.js";

test("safe action with no history is allowed", () => {
  const f = fixture();
  assert.equal(f.engine.evaluate(f.request("noop")).verdict, "allow");
});

test("sensitive read then external send requires approval, including after replan", () => {
  const f = fixture();
  f.history.append(f.fact("sensitive_read"));
  assert.equal(f.engine.evaluate(f.request("send")).verdict, "require_approval");
  assert.equal(f.engine.evaluate(f.request("send", "task-1", "intent-2", "plan-2")).verdict,
    "require_approval");
  assert.equal(f.engine.evaluate(f.request("send", "task-2")).verdict, "allow");
});

test("secret or credential context before public publish is hard deny", () => {
  for (const kind of ["secret_observed", "credential_access"] as const) {
    const f = fixture();
    f.history.append(f.fact(kind));
    const decision = f.engine.evaluate(f.request("publish"));
    assert.equal(decision.verdict, "deny");
    assert.ok(decision.ruleResults.some(result => result.verdict === "deny"));
  }
});

test("deny outranks approval and allow rules", () => {
  const f = fixture();
  f.history.append(f.fact("secret_observed"));
  const engine = new CompositionEngine(f.compiler, f.history, f.approvals,
    [...defaultCompositionRules(), { id: "FORCED_ALLOW", version: "1", evaluate: () => ({
      ruleId: "FORCED_ALLOW", verdict: "allow" as const, reason: "test"
    }) }], { now: () => 100 });
  assert.equal(engine.evaluate(f.request("publish")).verdict, "deny");
});

test("credential plus untrusted code and untrusted code plus robot action require approval", () => {
  const f = fixture();
  f.history.append(f.fact("credential_access"));
  assert.equal(f.engine.evaluate(f.request("run_untrusted")).verdict, "require_approval");
  f.history.append(f.fact("untrusted_code_executed"));
  assert.equal(f.engine.evaluate(f.request("move_robot")).verdict, "require_approval");
});

test("unknown sink trust requires approval and caller cannot self-classify", () => {
  const f = fixture();
  assert.equal(f.engine.evaluate({ ...f.request("send"), resourceIds: [unknownSinkId],
    sinkId: unknownSinkId }).verdict, "require_approval");
  assert.throws(() => f.engine.evaluate({ ...f.request("send"), actionType: "model_says_safe" }),
    /INVALID_COMPOSITION_CANDIDATE/);
  assert.throws(() => f.engine.evaluate({ ...f.request("send"),
    resourceIds: ["file:invented" as typeof unknownSinkId] }), /INVALID_COMPOSITION_CANDIDATE/);
});

test("history age filter excludes old facts but keeps task version", () => {
  const f = fixture(10);
  f.history.append(f.fact("sensitive_read", "task-1", 80));
  assert.equal(f.engine.evaluate(f.request("send")).verdict, "allow");
  assert.equal(f.engine.evaluate(f.request("send")).historyVersion, 1);
});

test("one rule cannot mutate the snapshot seen by later rules", () => {
  const f = fixture();
  f.history.append(f.fact("secret_observed"));
  const engine = new CompositionEngine(f.compiler, f.history, f.approvals, [
    { id: "MUTATOR", version: "1", evaluate: (history, candidate) => {
      (history as typeof history[number][]).length = 0;
      candidate.actionClass = "safe";
      return { ruleId: "MUTATOR", verdict: "allow", reason: "test" };
    } },
    ...defaultCompositionRules()
  ], { now: () => 100 });
  assert.equal(engine.evaluate(f.request("publish")).verdict, "deny");
});
