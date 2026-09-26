import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryObservationStore, InMemoryObserverRegistry, ObservationPolicy,
  ObservationService, type Observer, type Observation
} from "../src/index.js";
import { descriptor, expected, fakeClock, makeObservation, request, subject } from "./helpers.js";

function setup(observe: Observer["observe"]) {
  const clock = fakeClock();
  const observers = new InMemoryObserverRegistry();
  const store = new InMemoryObservationStore();
  observers.register({ descriptor: structuredClone(descriptor), observe });
  let next = 0;
  const service = new ObservationService(observers, store, new ObservationPolicy(clock),
    clock, { next: () => `generated-${++next}` });
  const input = { observerId: descriptor.id, request, riskClass: "R5" as const, maxAgeMs: 100 };
  return { service, store, observers, input, clock };
}

test("service validates, records and evaluates an independent observation", async () => {
  const f = setup(async () => makeObservation());
  const result = await f.service.observe(f.input);
  assert.equal(result.observation.status, "confirmed");
  assert.equal(result.evaluation.accepted, true);
  assert.equal(f.store.listByTask("task-1").length, 1);
});

test("observer exception becomes recorded UNKNOWN, not contradiction", async () => {
  const f = setup(async () => { throw new Error("network down"); });
  const result = await f.service.observe(f.input);
  assert.equal(result.observation.status, "unknown");
  assert.equal(result.observation.reason, "OBSERVER_ERROR");
  assert.equal(result.evaluation.effectiveStatus, "unknown");
  assert.equal(f.store.list().length, 1);
});

test("observer timeout becomes recorded UNKNOWN", async () => {
  const f = setup(async () => new Promise<Observation>(() => {}));
  const result = await f.service.observe({ ...f.input, timeoutMs: 5 });
  assert.equal(result.observation.status, "unknown");
  assert.equal(result.evaluation.reasonCode, "OBSERVATION_UNKNOWN");
});

test("unregistered observer and arbitrary model string cannot create accepted evidence", async () => {
  const f = setup(async () => makeObservation());
  await assert.rejects(() => f.service.observe({ ...f.input, observerId: "model-text" }),
    /OBSERVER_NOT_FOUND/);
  assert.equal(f.store.list().length, 0);
});

test("observer task, intent and resource mismatch reject without append", async () => {
  for (const changed of [
    { ...subject, taskId: "other" },
    { ...subject, intentId: "other" },
    { ...subject, resourceIds: [] }
  ]) {
    const f = setup(async () => makeObservation({ subject: changed }));
    await assert.rejects(() => f.service.observe(f.input), /OBSERVATION_SUBJECT_MISMATCH/);
    assert.equal(f.store.list().length, 0);
  }
});

test("observer cannot substitute another expected postcondition", async () => {
  const changed = { ...expected, expected: { agent: "astra", at: "elsewhere" } };
  const f = setup(async () => makeObservation({ expectedPostcondition: changed }));
  await assert.rejects(() => f.service.observe(f.input), /POSTCONDITION_MISMATCH/);
  assert.equal(f.store.list().length, 0);
});

test("observer identity, source and evidence are validated", async () => {
  for (const changed of [
    { observerId: "unregistered" },
    { source: "provider" as const },
    { evidence: [] }
  ]) {
    const f = setup(async () => makeObservation(changed));
    await assert.rejects(() => f.service.observe(f.input), /INVALID_OBSERVER_RESULT/);
    assert.equal(f.store.list().length, 0);
  }
});

test("observer descriptor is host-controlled snapshot", async () => {
  const mutable = structuredClone(descriptor);
  const observers = new InMemoryObserverRegistry();
  observers.register({ descriptor: mutable, observe: async () => makeObservation() });
  mutable.strength = "weak";
  assert.equal(observers.get(descriptor.id)?.descriptor.strength, "strong");
});

test("malformed observer descriptors and results fail closed", async () => {
  const observers = new InMemoryObserverRegistry();
  assert.throws(() => observers.register({
    descriptor: { ...descriptor, strength: "superstrong" as typeof descriptor.strength },
    observe: async () => makeObservation()
  }), /INVALID_OBSERVER_RESULT/);
  const f = setup(async () => makeObservation({ status: "succeeded" as Observation["status"] }));
  await assert.rejects(() => f.service.observe(f.input), /INVALID_OBSERVER_RESULT/);
  assert.equal(f.store.list().length, 0);
  await assert.rejects(() => f.service.observe({ ...f.input, timeoutMs: 0 }), /INVALID_OBSERVER_RESULT/);
});

test("observation has no API for authority, budget settlement or task completion", () => {
  const f = setup(async () => makeObservation());
  assert.equal("grantAuthority" in f.service, false);
  assert.equal("commitReservation" in f.service, false);
  assert.equal("completeTask" in f.service, false);
});
