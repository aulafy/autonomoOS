import assert from "node:assert/strict";
import test from "node:test";
import { effectIdempotencyKey, stableJson } from "../src/index.js";
import { baseInput, otherResourceId } from "./helpers.js";

test("stable JSON sorts object keys recursively and preserves array order", () => {
  assert.equal(stableJson({ b: 2, a: { z: 1, x: 3 } }),
    stableJson({ a: { x: 3, z: 1 }, b: 2 }));
  assert.notEqual(stableJson([1, 2]), stableJson([2, 1]));
});

test("same semantic effect has same key independent of object key order and metadata", () => {
  const first = effectIdempotencyKey({ ...baseInput,
    parameters: { destination: baseInput.resourceIds[0], mode: "walk" } });
  const reordered = { ...baseInput,
    parameters: { mode: "walk", destination: baseInput.resourceIds[0] },
    metadata: { attemptLoggedAt: 9999 }, executionId: "another-random-execution-id" };
  assert.equal(effectIdempotencyKey(reordered), first);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test("semantic parameter, canonical resource and intent changes alter key", () => {
  const first = effectIdempotencyKey(baseInput);
  assert.notEqual(effectIdempotencyKey({ ...baseInput,
    parameters: { destination: otherResourceId } }), first);
  assert.notEqual(effectIdempotencyKey({ ...baseInput,
    resourceIds: [otherResourceId] }), first);
  assert.notEqual(effectIdempotencyKey({ ...baseInput, intentId: "intent-2" }), first);
});

test("unsupported values and cycles reject instead of silently changing key", () => {
  assert.throws(() => stableJson({ value: undefined }), /INVALID_STABLE_JSON/);
  assert.throws(() => stableJson({ value: 1n }), /INVALID_STABLE_JSON/);
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  assert.throws(() => stableJson(cycle), /INVALID_STABLE_JSON/);
});
