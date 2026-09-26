import assert from "node:assert/strict";
import test from "node:test";
import { postconditionHash } from "@agent-world/observation";
import { descriptor, fixture, makeObservation, otherResourceId } from "./helpers.js";

const options = { riskClass: "R5" as const, maxAgeMs: 100 };

test("accepted confirmed observation commits after dispatch", () => {
  const f = fixture();
  f.reachDispatch();
  f.coordinator.recordDispatchResult("effect-1", 3, { kind: "reported_success", metadata: {} });
  f.observations.append(makeObservation());
  const effect = f.coordinator.settleFromObservation("effect-1", 4, "obs-1", options);
  assert.equal(effect.status, "committed");
  assert.deepEqual(effect.observationIds, ["obs-1"]);
  assert.equal(effect.settlementEvaluation?.reasonCode, "OBSERVATION_CONFIRMED");
  assert.deepEqual(effect.budgetReservationIds, ["reservation-1"]);
  assert.throws(() => f.coordinator.startDispatch("effect-1", 5), /INVALID_EFFECT_TRANSITION/);
});

test("accepted contradiction fails; unknown, inconclusive and stale stay UNKNOWN", () => {
  for (const [status, expectedStatus] of [
    ["contradicted", "failed"], ["unknown", "unknown"],
    ["inconclusive", "unknown"], ["stale", "unknown"]
  ] as const) {
    const f = fixture();
    f.reachDispatch();
    f.observations.append(makeObservation({ status }));
    const effect = f.coordinator.settleFromObservation("effect-1", 3, "obs-1", options);
    assert.equal(effect.status, expectedStatus, status);
    assert.deepEqual(effect.observationIds, ["obs-1"]);
  }
});

test("weak contradiction cannot certify failure", () => {
  const f = fixture({ ...descriptor, strength: "weak" });
  f.reachDispatch();
  f.observations.append(makeObservation({ status: "contradicted" }));
  const effect = f.coordinator.settleFromObservation("effect-1", 3, "obs-1", options);
  assert.equal(effect.status, "unknown");
  assert.equal(effect.settlementEvaluation?.accepted, false);
});

test("late callbacks and observations cannot change any terminal effect", () => {
  for (const observationStatus of ["confirmed", "contradicted", "unknown"] as const) {
    const f = fixture();
    f.reachDispatch();
    f.observations.append(makeObservation({ status: observationStatus }));
    const terminal = f.coordinator.settleFromObservation("effect-1", 3, "obs-1", options);
    f.observations.append(makeObservation({ id: "obs-late" }));
    assert.throws(() => f.coordinator.recordDispatchResult("effect-1", terminal.version, {
      kind: "reported_success", metadata: {}
    }), /INVALID_EFFECT_TRANSITION/);
    assert.throws(() => f.coordinator.recordExecutorError("effect-1", terminal.version),
      /INVALID_EFFECT_TRANSITION/);
    assert.throws(() => f.coordinator.settleFromObservation("effect-1", terminal.version,
      "obs-late", options), /INVALID_EFFECT_TRANSITION/);
    assert.equal(f.effects.get("effect-1")?.status, terminal.status);
    assert.deepEqual(f.effects.get("effect-1")?.observationIds, ["obs-1"]);
  }
});

test("raw confirmed with weak observer becomes UNKNOWN, never committed", () => {
  const f = fixture({ ...descriptor, strength: "weak" });
  f.reachDispatch();
  f.observations.append(makeObservation());
  const effect = f.coordinator.settleFromObservation("effect-1", 3, "obs-1", options);
  assert.equal(effect.status, "unknown");
  assert.equal(effect.settlementEvaluation?.accepted, false);
  assert.equal(effect.unknownReasonCode, "INSUFFICIENT_OBSERVATION_STRENGTH");
});

test("old observation becomes UNKNOWN at policy freshness boundary", () => {
  const f = fixture();
  f.reachDispatch();
  f.observations.append(makeObservation());
  f.clock.set(201);
  const effect = f.coordinator.settleFromObservation("effect-1", 3, "obs-1", options);
  assert.equal(effect.status, "unknown");
  assert.equal(effect.unknownReasonCode, "OBSERVATION_TOO_OLD");
});

test("wrong effect, task, resource or postcondition cannot settle", () => {
  const observations = [
    makeObservation({ subject: { ...makeObservation().subject, effectId: "effect-2" } }),
    makeObservation({ subject: { ...makeObservation().subject, taskId: "task-2" } }),
    makeObservation({ subject: { ...makeObservation().subject, resourceIds: [otherResourceId] } }),
    makeObservation({ expectedPostcondition: {
      ...makeObservation().expectedPostcondition,
      expected: { agent: "astra", at: otherResourceId }
    }, expectedPostconditionHash: postconditionHash({
      ...makeObservation().expectedPostcondition,
      expected: { agent: "astra", at: otherResourceId }
    }) })
  ];
  for (const observation of observations) {
    const f = fixture();
    f.reachDispatch();
    f.observations.append(observation);
    assert.throws(() => f.coordinator.settleFromObservation("effect-1", 3, "obs-1", options),
      /OBSERVATION_(EFFECT|SUBJECT)_MISMATCH/);
    assert.equal(f.effects.get("effect-1")?.status, "dispatching");
  }
});

test("settlement reads observation store, not caller-held copy", () => {
  const f = fixture();
  f.reachDispatch();
  const callerCopy = f.observations.append(makeObservation({ status: "unknown" }));
  callerCopy.status = "confirmed";
  const effect = f.coordinator.settleFromObservation("effect-1", 3, "obs-1", options);
  assert.equal(effect.status, "unknown");
  assert.equal(f.observations.get("obs-1")?.status, "unknown");
});

test("missing observation cannot settle and UNKNOWN cannot be redispatched", () => {
  const f = fixture();
  f.reachDispatch();
  assert.throws(() => f.coordinator.settleFromObservation("effect-1", 3, "missing", options),
    /OBSERVATION_NOT_FOUND/);
  f.observations.append(makeObservation({ status: "unknown" }));
  f.coordinator.settleFromObservation("effect-1", 3, "obs-1", options);
  assert.throws(() => f.coordinator.startDispatch("effect-1", 4), /INVALID_EFFECT_TRANSITION/);
  assert.deepEqual(f.effects.get("effect-1")?.budgetReservationIds, ["reservation-1"]);
});
