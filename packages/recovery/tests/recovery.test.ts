import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryBudgetLedger } from "@agent-world/budgets";
import { EffectCoordinator, InMemoryEffectEventSink, InMemoryEffectStore } from "@agent-world/effects";
import { InMemoryObservationStore, InMemoryObserverRegistry, ObservationPolicy,
  postconditionHash } from "@agent-world/observation";
import { InMemoryReconciliationQueue, ReconciliationService } from "@agent-world/reconciliation";
import { mintResourceId } from "@agent-world/resources";
import { InMemoryEmergencyStopStore, InMemoryQuarantineStore } from "@agent-world/supervision";
import { InMemoryRecoveryEventSink, RecoveryManager, RecoveryPlanner,
  RuntimeModeController } from "../src/index.js";

const resourceId = mintResourceId("world_place", "demo-office/meeting-room");

function fixture(options: { receipt?: boolean; createEffect?: boolean;
  reserve?: boolean } = {}) {
  let now = 100;
  const clock = { now: () => now };
  const budgets = new InMemoryBudgetLedger(clock);
  budgets.createBudget({ id: "b1", ownerPrincipalId: "astra", taskId: "t1",
    ceiling: { actions: "10" } });
  const reservation = options.reserve === false ? null : budgets.reserve({ id: "r1",
    budgetId: "b1", principalId: "astra",
    taskId: "t1", effectId: "e1", amount: { actions: "1" }, expiresAt: 120 }, 1);
  const observations = new InMemoryObservationStore();
  const observers = new InMemoryObserverRegistry();
  observers.register({ descriptor: { id: "observer", implementation: "fixture", sourceType: "world",
    independence: "independent_local", strength: "strong", authenticated: true, metadata: {} },
    observe: async () => { throw new Error("not called during recovery"); } });
  const policy = new ObservationPolicy(clock);
  const effects = new InMemoryEffectStore();
  const coordinator = new EffectCoordinator(effects, observations, observers, policy,
    new InMemoryEffectEventSink(), clock);
  const postcondition = { kind: "world_position", resourceIds: [resourceId],
    predicate: "position" as const, expected: { at: resourceId }, metadata: {} };
  if (options.createEffect !== false) coordinator.createEffect({ id: "e1", taskId: "t1", intentId: "i1",
    executionId: "x1", executorId: "executor", action: "goto", parameters: {},
    expectedPostcondition: postcondition, resourceIds: [resourceId],
    budgetReservationIds: [reservation!.id], metadata: { riskClass: "R1",
      observationMaxAgeMs: 100, ...(options.receipt === false ? {} :
        { budgetActualAmount: { actions: "1" } }) } });
  const queue = new InMemoryReconciliationQueue();
  const reconciliation = new ReconciliationService(effects, queue, observations,
    observers, policy, [], clock.now);
  const emergencyStop = new InMemoryEmergencyStopStore();
  const quarantines = new InMemoryQuarantineStore();
  const mode = new RuntimeModeController();
  const events = new InMemoryRecoveryEventSink();
  let authorityReadable = true;
  const manager = (modeOverride: RuntimeModeController = mode) => new RecoveryManager({
    effects, coordinator, observations,
    observers, observationPolicy: policy, budgets, queue,
    reconciliation, emergencyStop, quarantines, mode: modeOverride, events, now: clock.now,
    criticalStoresHealthy: () => true, policyHealthy: () => true,
    resourcesHealthy: () => true, authorityReadable: () => authorityReadable });
  return { effects, coordinator, budgets, observations, observers, policy, postcondition, queue,
    emergencyStop, quarantines, mode, events, manager,
    setNow: (value: number) => { now = value; },
    setAuthorityReadable: (value: boolean) => { authorityReadable = value; } };
}

function settleConfirmed(f: ReturnType<typeof fixture>): void {
  const created = f.effects.get("e1")!;
  const prepared = f.coordinator.prepare(created.id, created.version);
  const dispatching = f.coordinator.startDispatch(prepared.id, prepared.version);
  const reported = f.coordinator.recordDispatchResult(dispatching.id, dispatching.version,
    { kind: "reported_success", metadata: {} });
  const observation = f.observations.append({ id: "o1", observerId: "observer", source: "world",
    status: "confirmed", observedAt: 100, subject: { taskId: "t1", intentId: "i1",
      executionId: "x1", effectId: "e1", resourceIds: [resourceId] },
    expectedPostcondition: f.postcondition, expectedPostconditionHash: postconditionHash(f.postcondition),
    observedResourceGenerations: {}, evidence: [{ kind: "event", reference: "world-state", metadata: {} }],
    reason: "confirmed", metadata: {} });
  f.coordinator.settleFromObservation(reported.id, reported.version, observation.id,
    { riskClass: "R1", maxAgeMs: 100 });
}

test("prepared crash cleans up and releases only certified unstarted budget", () => {
  const f = fixture();
  const effect = f.effects.get("e1")!;
  f.coordinator.prepare(effect.id, effect.version);
  assert.equal(f.mode.allowsConsequentialDispatch(), false);
  const plan = new RecoveryPlanner(f.effects, () => 100).plan("p1");
  assert.deepEqual(plan.actions.map(action => action.kind), ["cleanup_pre_dispatch"]);
  assert.deepEqual(f.manager().run(plan), { mode: "normal", failedActions: [] });
  assert.equal(f.effects.get("e1")?.status, "failed");
  assert.equal(f.budgets.getReservation("r1")?.status, "released");
  assert.equal(f.events.events.at(-1)?.type, "recovery.completed");
});

test("reservation persisted before effect creation is cleaned without dispatch", () => {
  const f = fixture({ createEffect: false });
  const outcome = f.manager().run();
  assert.equal(outcome.mode, "normal");
  assert.equal(f.effects.list().length, 0);
  assert.equal(f.budgets.getReservation("r1")?.status, "released");
});

test("crash before budget reservation has no recovery action", () => {
  const f = fixture({ reserve: false, createEffect: false });
  assert.equal(f.manager().run().mode, "normal");
  assert.equal(f.budgets.listReservations().length, 0);
  assert.equal(f.effects.list().length, 0);
});

test("incomplete supplied recovery plan cannot open normal mode", () => {
  const f = fixture();
  const outcome = f.manager().run({ id: "forged", createdAt: 100, actions: [] });
  assert.equal(outcome.mode, "read_only");
  assert.equal(f.effects.get("e1")?.status, "preparing");
  assert.equal(f.budgets.getReservation("r1")?.status, "active");
});

test("dispatching crash becomes UNKNOWN, keeps hold and schedules one read-only job", () => {
  const f = fixture();
  const created = f.effects.get("e1")!;
  const prepared = f.coordinator.prepare(created.id, created.version);
  f.coordinator.startDispatch(prepared.id, prepared.version);
  f.setNow(200); // Reservation TTL passed; uncertainty still holds capacity.
  const plan = new RecoveryPlanner(f.effects, () => 200).plan("p1");
  assert.deepEqual(plan.actions.map(action => action.kind),
    ["mark_dispatching_unknown", "ensure_reconciliation"]);
  f.manager().run(plan);
  assert.equal(f.effects.get("e1")?.status, "unknown");
  assert.equal(f.effects.get("e1")?.unknownReasonCode, "CRASH_DURING_DISPATCH");
  assert.equal(f.budgets.getReservation("r1")?.status, "active");
  assert.equal(f.queue.list().length, 1);
  const again = new RuntimeModeController();
  const manager = new RecoveryManager({ effects: f.effects, coordinator: f.coordinator,
    observations: f.observations, observers: f.observers, observationPolicy: f.policy,
    budgets: f.budgets, queue: f.queue,
    reconciliation: new ReconciliationService(f.effects, f.queue, f.observations,
      new InMemoryObserverRegistry(), new ObservationPolicy({ now: () => 200 }), [], () => 200),
    emergencyStop: f.emergencyStop, quarantines: f.quarantines, mode: again,
    events: f.events, now: () => 200, criticalStoresHealthy: () => true,
    policyHealthy: () => true, resourcesHealthy: () => true, authorityReadable: () => true });
  manager.run(new RecoveryPlanner(f.effects, () => 200).plan("p2"));
  assert.equal(f.queue.list().length, 1);
});

test("committed effect repairs budget without another dispatch", () => {
  const f = fixture();
  settleConfirmed(f);
  assert.equal(f.effects.get("e1")?.status, "committed");
  assert.equal(f.budgets.getReservation("r1")?.status, "active");
  f.manager().run();
  assert.equal(f.budgets.getReservation("r1")?.status, "committed");
  assert.equal(f.effects.get("e1")?.status, "committed");
  const version = f.budgets.getReservation("r1")?.version;
  f.manager(new RuntimeModeController()).run();
  assert.equal(f.budgets.getReservation("r1")?.version, version);
});

test("missing accounting receipt keeps recovery read-only and budget held", () => {
  const f = fixture({ receipt: false });
  settleConfirmed(f);
  const outcome = f.manager().run();
  assert.equal(outcome.mode, "read_only");
  assert.deepEqual(outcome.failedActions, ["repair_committed_budget:e1"]);
  assert.equal(f.budgets.getReservation("r1")?.status, "active");
  assert.equal(f.effects.get("e1")?.status, "committed");
});

test("persisted confirmation settles dispatching effect without redispatch", () => {
  const f = fixture();
  const created = f.effects.get("e1")!;
  const prepared = f.coordinator.prepare(created.id, created.version);
  const dispatching = f.coordinator.startDispatch(prepared.id, prepared.version);
  f.coordinator.recordDispatchResult(dispatching.id, dispatching.version,
    { kind: "reported_success", metadata: {} });
  f.observations.append({ id: "o1", observerId: "observer", source: "world",
    status: "confirmed", observedAt: 100, subject: { taskId: "t1", intentId: "i1",
      executionId: "x1", effectId: "e1", resourceIds: [resourceId] },
    expectedPostcondition: f.postcondition, expectedPostconditionHash: postconditionHash(f.postcondition),
    observedResourceGenerations: {}, evidence: [{ kind: "event", reference: "durable-world-state",
      metadata: {} }], reason: "confirmed", metadata: {} });
  f.manager().run();
  assert.equal(f.effects.get("e1")?.status, "committed");
  assert.equal(f.budgets.getReservation("r1")?.status, "committed");
  assert.equal(f.queue.list().length, 0);
});

test("emergency stop and unreadable authority keep startup read-only", () => {
  const f = fixture();
  f.emergencyStop.activate("operator", 100);
  f.manager().run();
  assert.equal(f.mode.mode, "read_only");
  const g = fixture();
  g.setAuthorityReadable(false);
  g.manager().run();
  assert.equal(g.mode.mode, "read_only");
  const quarantined = fixture();
  quarantined.quarantines.add({ id: "q1", executorId: "executor", reason: "suspect",
    createdAt: 100, active: true });
  quarantined.manager().run();
  assert.equal(quarantined.quarantines.isQuarantined("executor"), true);
});

test("preparing crash is cleaned, while UNKNOWN never releases an expired hold", () => {
  const pre = fixture();
  pre.manager().run();
  assert.equal(pre.effects.get("e1")?.status, "failed");
  assert.equal(pre.budgets.getReservation("r1")?.status, "released");

  const unknown = fixture();
  const created = unknown.effects.get("e1")!;
  const prepared = unknown.coordinator.prepare(created.id, created.version);
  const dispatching = unknown.coordinator.startDispatch(prepared.id, prepared.version);
  unknown.coordinator.recordExecutorError(dispatching.id, dispatching.version);
  unknown.setNow(300);
  unknown.manager().run();
  assert.equal(unknown.effects.get("e1")?.status, "unknown");
  assert.equal(unknown.budgets.getReservation("r1")?.status, "active");
  assert.equal(unknown.queue.list().length, 1);
});

test("failed effect with uncertain start keeps its budget hold", () => {
  const uncertain = fixture();
  const created = uncertain.effects.get("e1")!;
  const prepared = uncertain.coordinator.prepare(created.id, created.version);
  const dispatching = uncertain.coordinator.startDispatch(prepared.id, prepared.version);
  const reported = uncertain.coordinator.recordDispatchResult(dispatching.id, dispatching.version,
    { kind: "reported_success", metadata: {} });
  const observation = uncertain.observations.append({ id: "o2", observerId: "observer",
    source: "world", status: "contradicted", observedAt: 100,
    subject: { taskId: "t1", intentId: "i1", executionId: "x1", effectId: "e1",
      resourceIds: [resourceId] }, expectedPostcondition: uncertain.postcondition,
    expectedPostconditionHash: postconditionHash(uncertain.postcondition),
    observedResourceGenerations: {}, evidence: [{ kind: "event", reference: "not-at-target",
      metadata: {} }], reason: "contradicted", metadata: {} });
  uncertain.coordinator.settleFromObservation(reported.id, reported.version, observation.id,
    { riskClass: "R1", maxAgeMs: 100 });
  uncertain.manager().run();
  assert.equal(uncertain.effects.get("e1")?.status, "failed");
  assert.equal(uncertain.budgets.getReservation("r1")?.status, "active");
});
