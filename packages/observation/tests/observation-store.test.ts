import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryObservationStore } from "../src/index.js";
import { makeObservation } from "./helpers.js";

test("append/get/list and subject indexes preserve history", () => {
  const store = new InMemoryObservationStore();
  store.append(makeObservation({ id: "obs-1", status: "unknown" }));
  store.append(makeObservation({ id: "obs-2", status: "confirmed" }));
  assert.equal(store.list().length, 2);
  assert.equal(store.listByTask("task-1").length, 2);
  assert.equal(store.listByTask("task-2").length, 0);
  assert.equal(store.listByExecution("execution-1").length, 2);
  assert.equal(store.listByEffect("effect-1").length, 2);
  assert.equal(store.get("obs-1")?.status, "unknown");
  assert.equal(store.get("obs-2")?.status, "confirmed");
});

test("duplicate observation ID rejects and reads are defensive copies", () => {
  const store = new InMemoryObservationStore();
  const original = makeObservation();
  store.append(original);
  assert.throws(() => store.append(makeObservation()), /DUPLICATE_OBSERVATION_ID/);
  original.status = "contradicted";
  const read = store.get("obs-1")!;
  read.subject.resourceIds.length = 0;
  read.evidence[0].reference = "tampered";
  assert.equal(store.get("obs-1")?.status, "confirmed");
  assert.equal(store.get("obs-1")?.evidence[0].reference, "world-event-1");
  assert.equal(store.get("obs-1")?.subject.resourceIds.length, 1);
});

test("a model string is not an Observation record", () => {
  const store = new InMemoryObservationStore();
  assert.throws(() => store.append("I think it succeeded" as unknown as ReturnType<typeof makeObservation>),
    /INVALID_OBSERVER_RESULT/);
  assert.equal(store.list().length, 0);
});
