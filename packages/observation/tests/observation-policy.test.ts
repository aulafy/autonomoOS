import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryResourceRegistry } from "@agent-world/resources";
import { ObservationPolicy, postconditionHash } from "../src/index.js";
import { descriptor, expected, fakeClock, home, makeObservation, room, subject } from "./helpers.js";

function requirement(overrides: Record<string, unknown> = {}) {
  return { subject, expectedPostcondition: expected, riskClass: "R5" as const,
    maxAgeMs: 100, ...overrides };
}

test("adequate evidence preserves confirmed and contradicted statuses", () => {
  const policy = new ObservationPolicy(fakeClock());
  assert.deepEqual(policy.evaluate(makeObservation(), descriptor, requirement()).effectiveStatus, "confirmed");
  const contradicted = policy.evaluate(makeObservation({ status: "contradicted" }), descriptor, requirement());
  assert.equal(contradicted.accepted, true);
  assert.equal(contradicted.effectiveStatus, "contradicted");
});

test("unknown, inconclusive and explicit stale remain distinct", () => {
  const policy = new ObservationPolicy(fakeClock());
  for (const status of ["unknown", "inconclusive", "stale"] as const) {
    const result = policy.evaluate(makeObservation({ status }), descriptor, requirement());
    assert.equal(result.accepted, false);
    assert.equal(result.effectiveStatus, status);
  }
});

test("weak evidence works for R0 but cannot confirm R5", () => {
  const policy = new ObservationPolicy(fakeClock());
  const weak = { ...descriptor, strength: "weak" as const };
  assert.equal(policy.evaluate(makeObservation(), weak, requirement({ riskClass: "R0" })).accepted, true);
  const high = policy.evaluate(makeObservation(), weak, requirement());
  assert.equal(high.accepted, false);
  assert.equal(high.effectiveStatus, "inconclusive");
  assert.equal(high.reasonCode, "INSUFFICIENT_OBSERVATION_STRENGTH");
});

test("moderate evidence satisfies R3 and same-executor reports stay weak", () => {
  const policy = new ObservationPolicy(fakeClock());
  const moderate = { ...descriptor, strength: "moderate" as const };
  assert.equal(policy.evaluate(makeObservation(), moderate, requirement({ riskClass: "R3" })).accepted, true);
  const selfReport = { ...descriptor, independence: "same_executor" as const };
  assert.equal(policy.evaluate(makeObservation(), selfReport, requirement()).accepted, false);
});

test("exact freshness boundary is accepted; older observation is stale", () => {
  const clock = fakeClock(200);
  const policy = new ObservationPolicy(clock);
  assert.equal(policy.evaluate(makeObservation({ observedAt: 100 }), descriptor,
    requirement({ maxAgeMs: 100 })).accepted, true);
  clock.set(201);
  const old = policy.evaluate(makeObservation({ observedAt: 100 }), descriptor,
    requirement({ maxAgeMs: 100 }));
  assert.equal(old.effectiveStatus, "stale");
  assert.equal(old.reasonCode, "OBSERVATION_TOO_OLD");
});

test("generation N remains valid and N+1 makes evidence stale", () => {
  const registry = new InMemoryResourceRegistry();
  const input = { id: room, kind: "world_place" as const, displayName: "Meeting Room",
    aliases: [], parentId: null, dataLabel: null, exclusivity: "shared" as const,
    sink: null, source: "host" as const };
  registry.register(input);
  const policy = new ObservationPolicy(fakeClock(), registry);
  const observation = makeObservation({ observedResourceGenerations: { [room]: 1 } });
  assert.equal(policy.evaluate(observation, descriptor,
    requirement({ requireGenerationBinding: true })).accepted, true);
  registry.update({ ...input, generation: 2 }, 1);
  const changed = policy.evaluate(observation, descriptor,
    requirement({ requireGenerationBinding: true }));
  assert.equal(changed.effectiveStatus, "stale");
  assert.equal(changed.reasonCode, "RESOURCE_GENERATION_CHANGED");
});

test("task, intent and resource binding prevent evidence reuse", () => {
  const policy = new ObservationPolicy(fakeClock());
  for (const changed of [
    { ...subject, taskId: "task-2" },
    { ...subject, intentId: "intent-2" },
    { ...subject, resourceIds: [home] }
  ]) {
    const result = policy.evaluate(makeObservation(), descriptor, requirement({ subject: changed }));
    assert.equal(result.accepted, false);
    assert.equal(result.reasonCode, "OBSERVATION_SUBJECT_MISMATCH");
  }
});

test("postcondition hash binds evidence to the exact expectation", () => {
  const policy = new ObservationPolicy(fakeClock());
  const different = { ...expected, expected: { agent: "astra", at: home } };
  assert.notEqual(postconditionHash(expected), postconditionHash(different));
  const result = policy.evaluate(makeObservation(), descriptor,
    requirement({ expectedPostcondition: different }));
  assert.equal(result.accepted, false);
  assert.equal(result.reasonCode, "POSTCONDITION_MISMATCH");
});

test("accepted conflicting evidence yields inconclusive", () => {
  const policy = new ObservationPolicy(fakeClock());
  const result = policy.evaluateObservations([
    { observation: makeObservation({ id: "obs-1" }), descriptor },
    { observation: makeObservation({ id: "obs-2", status: "contradicted" }), descriptor }
  ], requirement());
  assert.equal(result.accepted, false);
  assert.equal(result.effectiveStatus, "inconclusive");
  assert.equal(result.reasonCode, "CONFLICTING_EVIDENCE");
});

test("unexpected raw status is never accepted as confirmed", () => {
  const policy = new ObservationPolicy(fakeClock());
  const result = policy.evaluate(makeObservation({
    status: "succeeded" as ReturnType<typeof makeObservation>["status"]
  }), descriptor, requirement());
  assert.equal(result.accepted, false);
  assert.equal(result.effectiveStatus, "unknown");
});

test("invalid descriptor cannot accidentally satisfy strength policy", () => {
  const policy = new ObservationPolicy(fakeClock());
  const result = policy.evaluate(makeObservation(), {
    ...descriptor, strength: "superstrong" as typeof descriptor.strength
  }, requirement({ riskClass: "R0" }));
  assert.equal(result.accepted, false);
  assert.equal(result.effectiveStatus, "inconclusive");
});
