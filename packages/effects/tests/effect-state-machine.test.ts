import assert from "node:assert/strict";
import test from "node:test";
import { baseInput, fixture } from "./helpers.js";

test("success report stays dispatching until observation", () => {
  const f = fixture();
  const dispatching = f.reachDispatch();
  assert.equal(dispatching.status, "dispatching");
  assert.equal(f.effects.get("effect-1")?.status, "dispatching");
  const reported = f.coordinator.recordDispatchResult("effect-1", 3, {
    kind: "reported_success", externalReference: "provider-123", metadata: {}
  });
  assert.equal(reported.status, "dispatching");
  assert.equal(reported.externalReference, "provider-123");
  assert.equal(reported.version, 4);
});

test("certified not-started failure is failed, ambiguous failure is unknown", () => {
  const certified = fixture();
  certified.reachDispatch();
  const failed = certified.coordinator.recordDispatchResult("effect-1", 3, {
    kind: "reported_failure", certainty: "certified_not_started", reason: "rejected before send",
    metadata: {}
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.failureCertainty, "certified_not_started");
  const ambiguous = fixture();
  ambiguous.reachDispatch();
  const unknown = ambiguous.coordinator.recordDispatchResult("effect-1", 3, {
    kind: "reported_failure", certainty: "may_have_started", reason: "timeout",
    metadata: {}
  });
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.failureCertainty, "may_have_started");
});

test("explicit unknown and executor exception after dispatch stay UNKNOWN", () => {
  const explicit = fixture();
  explicit.reachDispatch();
  assert.equal(explicit.coordinator.recordDispatchResult("effect-1", 3, {
    kind: "unknown", reason: "provider unavailable", externalReference: "txn-1", metadata: {}
  }).status, "unknown");
  const thrown = fixture();
  thrown.reachDispatch();
  const unknown = thrown.coordinator.recordExecutorError("effect-1", 3);
  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.unknownReasonCode, "EXECUTOR_ERROR_AFTER_DISPATCH");
});

test("pre-dispatch failure is certified not started", () => {
  const preparing = fixture();
  preparing.coordinator.createEffect(baseInput);
  assert.equal(preparing.coordinator.failBeforeDispatch("effect-1", 1, "validation failed").status, "failed");
  const prepared = fixture();
  prepared.coordinator.createEffect(baseInput);
  prepared.coordinator.prepare("effect-1", 1);
  const failed = prepared.coordinator.failBeforeDispatch("effect-1", 2, "lease revoked");
  assert.equal(failed.failureCertainty, "certified_not_started");
  assert.equal(failed.dispatchStartedAt, undefined);
});

test("prepared cannot commit and terminal states cannot transition in C6", () => {
  const f = fixture();
  f.coordinator.createEffect(baseInput);
  f.coordinator.prepare("effect-1", 1);
  assert.throws(() => f.coordinator.startDispatch("effect-1", 1), /VERSION_CONFLICT/);
  assert.throws(() => f.coordinator.settleFromObservation("effect-1", 2, "obs-1", {
    riskClass: "R1", maxAgeMs: 100
  }), /INVALID_EFFECT_TRANSITION/);
  f.coordinator.startDispatch("effect-1", 2);
  f.coordinator.recordDispatchResult("effect-1", 3, {
    kind: "unknown", reason: "timeout", metadata: {}
  });
  assert.throws(() => f.coordinator.startDispatch("effect-1", 4), /INVALID_EFFECT_TRANSITION/);
  assert.throws(() => f.coordinator.recordDispatchResult("effect-1", 4, {
    kind: "reported_success", metadata: {}
  }), /INVALID_EFFECT_TRANSITION/);
  assert.throws(() => f.coordinator.settleFromObservation("effect-1", 4, "obs-1", {
    riskClass: "R1", maxAgeMs: 100
  }), /INVALID_EFFECT_TRANSITION/);
});

test("committed and failed are terminal too", () => {
  const failed = fixture();
  failed.reachDispatch();
  failed.coordinator.recordDispatchResult("effect-1", 3, {
    kind: "reported_failure", certainty: "certified_not_started", reason: "blocked", metadata: {}
  });
  assert.throws(() => failed.coordinator.startDispatch("effect-1", 4), /INVALID_EFFECT_TRANSITION/);
});

test("dispatching is stored before any executor call", () => {
  const f = fixture();
  f.coordinator.createEffect(baseInput);
  f.coordinator.prepare("effect-1", 1);
  const beforeExternalCall = f.coordinator.startDispatch("effect-1", 2);
  assert.equal(beforeExternalCall.status, "dispatching");
  assert.equal(f.effects.get("effect-1")?.status, "dispatching");
});
