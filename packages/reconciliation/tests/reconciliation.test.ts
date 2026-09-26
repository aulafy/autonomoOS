import assert from "node:assert/strict";
import test from "node:test";
import { mintResourceId } from "@agent-world/resources";
import { EffectCoordinator, InMemoryEffectEventSink, InMemoryEffectStore } from "@agent-world/effects";
import { InMemoryObservationStore, InMemoryObserverRegistry, ObservationPolicy,
  postconditionHash, type Observation } from "@agent-world/observation";
import { FixtureReconciler, InMemoryReconciliationQueue, ReconciliationService,
  resolveEffectiveEffectOutcome,
  type ReconcileResult } from "../src/index.js";

const resourceId = mintResourceId("world_place", "demo-office/meeting-room");
const expectedPostcondition = { kind: "agent_position", resourceIds: [resourceId],
  predicate: "position" as const, expected: { at: resourceId }, metadata: {} };
const options = { riskClass: "R5" as const, maxAgeMs: 100 };

function observation(id: string, status: Observation["status"]): Observation {
  return { id, status, observerId: "observer-1", source: "fixture", observedAt: 100,
    subject: { taskId: "task-1", intentId: "intent-1", executionId: "execution-1",
      effectId: "effect-1", resourceIds: [resourceId] },
    expectedPostcondition, expectedPostconditionHash: postconditionHash(expectedPostcondition),
    observedResourceGenerations: {},
    evidence: [{ kind: "event", reference: `event-${id}`, metadata: {} }], reason: "fixture lookup", metadata: {} };
}

function fixture(result: ReconcileResult | readonly ReconcileResult[], maxAttempts = 2,
  strength: "weak" | "strong" = "strong") {
  let now = 100;
  const clock = { now: () => now };
  const effects = new InMemoryEffectStore();
  const observations = new InMemoryObservationStore();
  const observers = new InMemoryObserverRegistry();
  observers.register({ descriptor: { id: "observer-1", implementation: "fixture",
    sourceType: "world", independence: "independent_local", strength,
    authenticated: true, metadata: {} }, observe: async () => observation("obs-default", "confirmed") });
  const policy = new ObservationPolicy(clock);
  const coordinator = new EffectCoordinator(effects, observations, observers, policy,
    new InMemoryEffectEventSink(), clock);
  coordinator.createEffect({ id: "effect-1", taskId: "task-1", intentId: "intent-1",
    executionId: "execution-1", executorId: "executor-1", action: "goto",
    parameters: { to: resourceId }, expectedPostcondition, resourceIds: [resourceId] });
  coordinator.prepare("effect-1", 1);
  coordinator.startDispatch("effect-1", 2);
  coordinator.recordDispatchResult("effect-1", 3,
    { kind: "unknown", reason: "timeout", metadata: {} });
  const queue = new InMemoryReconciliationQueue();
  const reconciler = new FixtureReconciler(result);
  const service = new ReconciliationService(effects, queue, observations, observers, policy,
    [reconciler], () => now);
  service.enqueue("job-1", "effect-1", maxAttempts);
  return { effects, observations, queue, reconciler, service, setNow: (value: number) => { now = value; } };
}

test("UNKNOWN plus accepted confirmation appends decision without rewriting C6", async () => {
  const f = fixture({ kind: "observations", observations: [observation("obs-1", "confirmed")] });
  const decision = await f.service.run("job-1", options);
  assert.equal(decision.outcome, "confirmed_effect");
  assert.deepEqual(decision.observationIds, ["obs-1"]);
  assert.equal(f.queue.get("job-1")?.status, "resolved");
  assert.equal(f.effects.get("effect-1")?.status, "unknown");
  assert.deepEqual(f.effects.get("effect-1")?.observationIds, []);
  assert.deepEqual(f.queue.listDecisions("effect-1"), [decision]);
  assert.deepEqual(f.reconciler.lookups, ["effect-1"]);
  const resolution = resolveEffectiveEffectOutcome(f.effects.get("effect-1")!,
    f.queue.listDecisions("effect-1"));
  assert.equal(resolution.originalEffectStatus, "unknown");
  assert.equal(resolution.effectiveOutcome, "committed");
  assert.equal(resolution.resolvedByDecisionId, decision.id);
});

test("accepted contradiction needs explicit no-effect certificate", async () => {
  const weak = fixture({ kind: "observations", observations: [observation("obs-1", "contradicted")] });
  assert.equal((await weak.service.run("job-1", options)).outcome, "ambiguous");
  const certified = fixture({ kind: "observations", observations: [observation("obs-1", "contradicted")],
    noEffectCertificate: { kind: "idempotency_key_never_processed",
      idempotencyKey: weak.effects.get("effect-1")!.idempotencyKey,
      authority: "fixture-provider", reference: "lookup-1" } });
  assert.equal((await certified.service.run("job-1", options)).outcome, "confirmed_no_effect");
  assert.equal(certified.effects.get("effect-1")?.status, "unknown");
  assert.equal(resolveEffectiveEffectOutcome(certified.effects.get("effect-1")!,
    certified.queue.listDecisions()).effectiveOutcome, "failed");
});

test("conflicting strong evidence is quarantined", async () => {
  const f = fixture({ kind: "observations", observations: [
    observation("obs-1", "confirmed"), observation("obs-2", "contradicted")
  ] });
  assert.equal((await f.service.run("job-1", options)).outcome, "conflicting");
  assert.equal(f.queue.get("job-1")?.status, "exhausted");
  assert.equal(resolveEffectiveEffectOutcome(f.effects.get("effect-1")!,
    f.queue.listDecisions()).effectiveOutcome, "unknown");
});

test("ambiguous evidence schedules another lookup, never another dispatch", async () => {
  const f = fixture({ kind: "observations", observations: [] });
  assert.equal((await f.service.run("job-1", options)).outcome, "ambiguous");
  assert.equal(f.queue.get("job-1")?.nextAttemptAt, 1100);
  await assert.rejects(f.service.run("job-1", options), /RECONCILIATION_NOT_READY/);
  f.setNow(1100);
  assert.equal((await f.service.run("job-1", options)).outcome, "ambiguous");
  assert.equal(f.queue.get("job-1")?.status, "exhausted");
  assert.equal(f.effects.get("effect-1")?.version, 4);
  assert.deepEqual(f.reconciler.lookups, ["effect-1", "effect-1"]);
});

test("repeated lookup may return the same observation ID without stranding the job", async () => {
  const f = fixture({ kind: "observations", observations: [observation("obs-1", "unknown")] });
  assert.equal((await f.service.run("job-1", options)).outcome, "ambiguous");
  f.setNow(1100);
  assert.equal((await f.service.run("job-1", options)).outcome, "ambiguous");
  assert.equal(f.queue.get("job-1")?.status, "exhausted");
  assert.equal(f.observations.listByEffect("effect-1").length, 1);
});

test("earlier accepted evidence participates in conflict detection", async () => {
  const f = fixture({ kind: "observations", observations: [observation("obs-2", "confirmed")] });
  f.observations.append(observation("obs-1", "contradicted"));
  assert.equal((await f.service.run("job-1", options)).outcome, "conflicting");
});

test("superseded is an appended decision and duplicate jobs are rejected", async () => {
  const f = fixture({ kind: "superseded", reason: "task generation advanced",
    reference: "task-generation-2" });
  assert.throws(() => f.service.enqueue("job-2", "effect-1", 2), /RECONCILIATION_ALREADY_QUEUED/);
  assert.equal((await f.service.run("job-1", options)).outcome, "superseded");
  assert.equal(f.effects.get("effect-1")?.status, "unknown");
  assert.equal(resolveEffectiveEffectOutcome(f.effects.get("effect-1")!,
    f.queue.listDecisions()).reconciliationOutcome, "superseded");
});

test("later accepted confirmation supersedes ambiguous decision and preserves both", async () => {
  const f = fixture([
    { kind: "observations", observations: [observation("obs-1", "unknown")] },
    { kind: "observations", observations: [{ ...observation("obs-2", "confirmed"), observedAt: 1100 }] }
  ]);
  const first = await f.service.run("job-1", options);
  f.setNow(1100);
  const second = await f.service.run("job-1", options);
  assert.equal(second.supersedesDecisionId, first.id);
  assert.equal(f.queue.listDecisions().length, 2);
  assert.equal(resolveEffectiveEffectOutcome(f.effects.get("effect-1")!,
    f.queue.listDecisions()).effectiveOutcome, "committed");
  assert.equal(f.effects.get("effect-1")?.status, "unknown");
});

test("weak confirmation, lookup error and timeout remain unresolved", async () => {
  const weak = fixture({ kind: "observations", observations: [observation("obs-1", "confirmed")] },
    2, "weak");
  assert.equal((await weak.service.run("job-1", options)).outcome, "ambiguous");
  const error = fixture({ kind: "observations", observations: [] });
  error.reconciler.reconcile = async () => { throw new Error("provider lookup failed"); };
  assert.equal((await error.service.run("job-1", options)).outcome, "ambiguous");
  assert.equal(error.effects.get("effect-1")?.status, "unknown");
  const timeout = fixture({ kind: "observations", observations: [] });
  const signal = AbortSignal.timeout(1);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await timeout.service.run("job-1", options, signal)).outcome, "ambiguous");
  assert.equal(timeout.queue.get("job-1")?.status, "queued");
});

test("lookup not found or certificate for another key does not certify absence", async () => {
  const f = fixture({ kind: "observations", observations: [], noEffectCertificate: {
    kind: "idempotency_key_never_processed", idempotencyKey: "another-key",
    authority: "fixture-provider", reference: "404" } });
  assert.equal((await f.service.run("job-1", options)).outcome, "ambiguous");
  assert.equal(resolveEffectiveEffectOutcome(f.effects.get("effect-1")!,
    f.queue.listDecisions()).effectiveOutcome, "unknown");
  const wrongKey = fixture({ kind: "observations", observations: [observation("obs-1", "contradicted")],
    noEffectCertificate: { kind: "idempotency_key_never_processed", idempotencyKey: "another-key",
      authority: "fixture-provider", reference: "lookup-2" } });
  assert.equal((await wrongKey.service.run("job-1", options)).outcome, "ambiguous");
});

test("decision supersession rejects self reference and other effects", () => {
  const queue = new InMemoryReconciliationQueue();
  queue.enqueue({ id: "job-a", effectId: "effect-a", attempts: 0, maxAttempts: 2,
    nextAttemptAt: 0, status: "queued", createdAt: 0, updatedAt: 0, version: 1 });
  queue.enqueue({ id: "job-b", effectId: "effect-b", attempts: 0, maxAttempts: 2,
    nextAttemptAt: 0, status: "queued", createdAt: 0, updatedAt: 0, version: 1 });
  queue.update({ ...queue.get("job-a")!, status: "running", attempts: 1, version: 2 }, 1);
  queue.update({ ...queue.get("job-b")!, status: "running", attempts: 1, version: 2 }, 1);
  const first = { id: "decision-a", jobId: "job-a", effectId: "effect-a", attempt: 1,
    outcome: "ambiguous" as const, observationIds: [], reason: "unresolved",
    reconcilerId: "fixture", at: 0 };
  queue.appendDecision(first);
  const other = { ...first, id: "decision-b", jobId: "job-b", effectId: "effect-b" };
  assert.throws(() => queue.appendDecision({ ...other, supersedesDecisionId: first.id }),
    /INVALID_DECISION_SUPERSESSION/);
  assert.throws(() => queue.appendDecision({ ...other, supersedesDecisionId: other.id }),
    /INVALID_DECISION_SUPERSESSION/);
});

test("read model rejects a purported absence decision without its certificate", async () => {
  const f = fixture({ kind: "observations", observations: [observation("obs-1", "contradicted")],
    noEffectCertificate: { kind: "idempotency_key_never_processed",
      idempotencyKey: "wrong", authority: "fixture-provider", reference: "lookup-1" } });
  const decision = await f.service.run("job-1", options);
  assert.throws(() => resolveEffectiveEffectOutcome(f.effects.get("effect-1")!, [{
    ...decision, outcome: "confirmed_no_effect", noEffectCertificate: undefined
  }]), /INVALID_RECONCILIATION_HISTORY/);
});

test("reconciliation exports no effect dispatch or retry method", () => {
  const methods = Object.getOwnPropertyNames(ReconciliationService.prototype);
  for (const forbidden of ["dispatch", "retryEffect", "redispatchEffect", "startDispatch"]) {
    assert.equal(methods.includes(forbidden), false);
  }
});

test("only one caller can start a queued lookup", async () => {
  const f = fixture({ kind: "observations", observations: [] });
  const first = f.service.run("job-1", options);
  await assert.rejects(f.service.run("job-1", options), /RECONCILIATION_NOT_READY/);
  await first;
  assert.deepEqual(f.reconciler.lookups, ["effect-1"]);
});
