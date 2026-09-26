import assert from "node:assert/strict";
import test from "node:test";
import { baseInput, fixture } from "./helpers.js";

test("duplicate effect ID and duplicate semantic key are rejected", () => {
  const f = fixture();
  const first = f.coordinator.createEffect(baseInput);
  assert.throws(() => f.coordinator.createEffect(baseInput), /EFFECT_ALREADY_EXISTS/);
  assert.throws(() => f.coordinator.createEffect({ ...baseInput,
    id: "effect-2", executionId: "execution-2" }), /EFFECT_IDEMPOTENCY_CONFLICT/);
  assert.equal(f.effects.findByIdempotencyKey(first.idempotencyKey)?.id, first.id);
});

test("competing callers with one semantic key cannot both reach dispatch", () => {
  const f = fixture();
  const first = f.coordinator.createEffect(baseInput);
  assert.throws(() => f.coordinator.createEffect({
    ...baseInput, id: "effect-2", executionId: "execution-2"
  }), /EFFECT_IDEMPOTENCY_CONFLICT/);
  f.coordinator.prepare(first.id, first.version);
  f.coordinator.startDispatch(first.id, 2);
  assert.equal(f.effects.listByStatus("dispatching").length, 1);
  assert.equal(f.effects.list().length, 1);
});

test("store indexes and defensive copies", () => {
  const f = fixture();
  const created = f.coordinator.createEffect(baseInput);
  created.resourceIds.length = 0;
  created.metadata.attemptLoggedAt = 999;
  assert.equal(f.effects.get("effect-1")?.resourceIds.length, 1);
  assert.equal(f.effects.get("effect-1")?.metadata.attemptLoggedAt, 100);
  assert.equal(f.effects.listByTask("task-1").length, 1);
  assert.equal(f.effects.listByIntent("intent-1").length, 1);
  assert.equal(f.effects.listByStatus("preparing").length, 1);
  f.effects.list()[0].observationIds.push("invented");
  assert.deepEqual(f.effects.get("effect-1")?.observationIds, []);
});

test("effect creation requires binding IDs, canonical resources and fences", () => {
  for (const input of [
    { ...baseInput, taskId: "" },
    { ...baseInput, intentId: "" },
    { ...baseInput, executionId: "" },
    { ...baseInput, executorId: "" },
    { ...baseInput, resourceIds: ["meeting_room" as typeof baseInput.resourceIds[number]] },
    { ...baseInput, resourceFences: {} }
  ]) {
    const f = fixture();
    assert.throws(() => f.coordinator.createEffect(input), /INVALID_EFFECT_INPUT/);
  }
});

test("stale version and rewritten immutable fields reject", () => {
  const f = fixture();
  f.coordinator.createEffect(baseInput);
  f.coordinator.prepare("effect-1", 1);
  assert.throws(() => f.coordinator.startDispatch("effect-1", 1), /VERSION_CONFLICT/);
  const current = f.effects.get("effect-1")!;
  assert.throws(() => f.effects.update({ ...current, taskId: "other",
    status: "dispatching", version: 3 }, 2), /INVALID_EFFECT_INPUT/);
});

test("store cannot directly commit without accepted observation proof", () => {
  const f = fixture();
  f.reachDispatch();
  const current = f.effects.get("effect-1")!;
  assert.throws(() => f.effects.update({ ...current,
    status: "committed", version: 4 }, 3), /INVALID_EFFECT_TRANSITION/);
});
