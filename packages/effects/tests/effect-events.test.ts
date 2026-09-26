import assert from "node:assert/strict";
import test from "node:test";
import { fixture, makeObservation } from "./helpers.js";

test("happy path event order and provenance", () => {
  const f = fixture();
  f.reachDispatch();
  f.coordinator.recordDispatchResult("effect-1", 3, {
    kind: "reported_success", metadata: {}
  });
  f.observations.append(makeObservation());
  f.coordinator.settleFromObservation("effect-1", 4, "obs-1", {
    riskClass: "R5", maxAgeMs: 100
  });
  assert.deepEqual(f.events.list().map(event => event.type), [
    "effect.created", "effect.prepared", "effect.dispatch_started",
    "effect.dispatch_reported", "effect.committed"
  ]);
  assert.equal(f.events.list()[4].effectId, "effect-1");
  assert.equal(f.effects.get("effect-1")?.authorityLeaseIds[0], "lease-1");
  assert.equal(f.effects.get("effect-1")?.resourceFences["place:demo-office/meeting-room"], "41");
});

test("ambiguous dispatch result records reported and UNKNOWN in order", () => {
  const f = fixture();
  f.reachDispatch();
  f.coordinator.recordDispatchResult("effect-1", 3, {
    kind: "reported_failure", certainty: "may_have_started", reason: "timeout", metadata: {}
  });
  assert.deepEqual(f.events.list().map(event => event.type), [
    "effect.created", "effect.prepared", "effect.dispatch_started",
    "effect.dispatch_reported", "effect.unknown"
  ]);
  const event = f.events.list()[4];
  event.details.reason = "tampered";
  assert.equal(f.events.list()[4].details.reason, "DISPATCH_OUTCOME_UNKNOWN");
});
