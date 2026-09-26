import assert from "node:assert/strict";
import test from "node:test";
import { EffectCoordinator, InMemoryEffectEventSink, InMemoryEffectStore } from "@agent-world/effects";
import { InMemoryObservationStore, InMemoryObserverRegistry, ObservationPolicy,
  postconditionHash, type ObserverDescriptor } from "@agent-world/observation";
import { FactCompiler } from "../src/index.js";
import { fixture, fileId, walletId } from "./helpers.js";

function effectFixture() {
  const f = fixture();
  const effects = new InMemoryEffectStore();
  const observations = new InMemoryObservationStore();
  const observers = new InMemoryObserverRegistry();
  const clock = { now: () => 100 };
  const policy = new ObservationPolicy(clock);
  const coordinator = new EffectCoordinator(effects, observations, observers, policy,
    new InMemoryEffectEventSink(), clock);
  const compiler = new FactCompiler(f.history, effects, observations, observers, policy,
    f.actions, { secret_access: "secret_observed" });
  return { ...f, effects, observations, observers, policy, coordinator, compiler };
}

test("payment dispatch becomes one attempt fact that survives UNKNOWN and replan", () => {
  const f = effectFixture();
  f.coordinator.createEffect({ id: "effect-1", taskId: "task-1", intentId: "intent-1",
    executionId: "execution-1", executorId: "payment-executor", action: "pay",
    parameters: { amount: "10" }, resourceIds: [walletId],
    expectedPostcondition: { kind: "payment", predicate: "provider_status",
      expected: "paid", resourceIds: [walletId], metadata: {} } });
  assert.equal(f.compiler.fromEffect("effect-1"), null);
  f.coordinator.prepare("effect-1", 1);
  assert.equal(f.compiler.fromEffect("effect-1"), null);
  f.coordinator.startDispatch("effect-1", 2);
  const fact = f.compiler.fromEffect("effect-1")!;
  assert.equal(fact.kind, "payment_attempted");
  assert.equal(fact.source, "effect_attempt");
  f.coordinator.recordDispatchResult("effect-1", 3,
    { kind: "unknown", reason: "timeout", metadata: {} });
  assert.equal(f.compiler.fromEffect("effect-1")?.id, fact.id);
  assert.equal(f.history.currentVersion("task-1"), 1);
  assert.equal(f.engine.evaluate(f.request("pay", "task-1", "intent-2", "plan-2")).verdict,
    "require_approval");
  assert.equal(f.effects.get("effect-1")?.status, "unknown");
});

test("external send dispatch becomes an attempt fact before its outcome is known", () => {
  const f = effectFixture();
  f.coordinator.createEffect({ id: "effect-1", taskId: "task-1", intentId: "intent-1",
    executionId: "execution-1", executorId: "email-executor", action: "send",
    parameters: { to: "external" }, resourceIds: [fileId],
    expectedPostcondition: { kind: "email_sent", predicate: "provider_status",
      expected: "sent", resourceIds: [fileId], metadata: {} } });
  f.coordinator.prepare("effect-1", 1);
  assert.deepEqual(f.compiler.fromEffectFacts("effect-1"), []);
  f.coordinator.startDispatch("effect-1", 2);
  assert.deepEqual(f.compiler.fromEffectFacts("effect-1").map(fact => fact.kind),
    ["external_send_attempted"]);
  f.coordinator.recordDispatchResult("effect-1", 3,
    { kind: "unknown", reason: "timeout", metadata: {} });
  assert.deepEqual(f.compiler.fromEffectFacts("effect-1").map(fact => fact.kind),
    ["external_send_attempted"]);
  assert.equal(f.history.currentVersion("task-1"), 1);
});

test("only accepted confirmed observations produce secret facts", () => {
  for (const strength of ["weak", "strong"] as const) {
    const f = effectFixture();
    const descriptor: ObserverDescriptor = { id: "observer-1", implementation: "fixture",
      sourceType: "filesystem", independence: "independent_local", strength,
      authenticated: true, metadata: {} };
    f.observers.register({ descriptor, observe: async () => { throw new Error("unused"); } });
    const expectedPostcondition = { kind: "secret_access", predicate: "exists" as const,
      expected: true, resourceIds: [fileId], metadata: {} };
    f.observations.append({ id: "obs-1", observerId: "observer-1", source: "fixture",
      status: "confirmed", observedAt: 100, expectedPostcondition,
      expectedPostconditionHash: postconditionHash(expectedPostcondition),
      subject: { taskId: "task-1", intentId: "intent-1", executionId: "execution-1",
        resourceIds: [fileId] }, observedResourceGenerations: {},
      evidence: [{ kind: "event", reference: "event-1", metadata: {} }],
      reason: "read-back", metadata: {} });
    const fact = f.compiler.fromObservation("obs-1", { riskClass: "R5", maxAgeMs: 100 });
    assert.equal(fact?.kind ?? null, strength === "strong" ? "secret_observed" : null);
    assert.equal(f.history.currentVersion("task-1"), strength === "strong" ? 1 : 0);
    if (strength === "strong") {
      assert.equal(f.engine.evaluate(f.request("publish")).verdict, "deny");
      assert.equal(f.compiler.fromObservation("obs-1", { riskClass: "R5", maxAgeMs: 100 })?.id,
        fact?.id);
      assert.equal(f.history.currentVersion("task-1"), 1);
    }
  }
});

test("committed host-classified read becomes sensitive history", () => {
  const f = effectFixture();
  const descriptor: ObserverDescriptor = { id: "observer-1", implementation: "fixture",
    sourceType: "filesystem", independence: "independent_local", strength: "strong",
    authenticated: true, metadata: {} };
  f.observers.register({ descriptor, observe: async () => { throw new Error("unused"); } });
  const expectedPostcondition = { kind: "read_completed", predicate: "exists" as const,
    expected: true, resourceIds: [fileId], metadata: {} };
  f.coordinator.createEffect({ id: "effect-1", taskId: "task-1", intentId: "intent-1",
    executionId: "execution-1", executorId: "file-executor", action: "read",
    parameters: { path: fileId }, resourceIds: [fileId], expectedPostcondition });
  f.coordinator.prepare("effect-1", 1);
  f.coordinator.startDispatch("effect-1", 2);
  f.observations.append({ id: "obs-1", observerId: "observer-1", source: "fixture",
    status: "confirmed", observedAt: 100, expectedPostcondition,
    expectedPostconditionHash: postconditionHash(expectedPostcondition),
    subject: { taskId: "task-1", intentId: "intent-1", executionId: "execution-1",
      effectId: "effect-1", resourceIds: [fileId] }, observedResourceGenerations: {},
    evidence: [{ kind: "event", reference: "event-1", metadata: {} }],
    reason: "read-back", metadata: {} });
  f.coordinator.settleFromObservation("effect-1", 3, "obs-1",
    { riskClass: "R5", maxAgeMs: 100 });
  assert.equal(f.compiler.fromEffect("effect-1")?.kind, "sensitive_read");
  assert.equal(f.engine.evaluate(f.request("send")).verdict, "require_approval");
});
