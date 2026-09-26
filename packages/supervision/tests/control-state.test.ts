import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryEmergencyStopStore, InMemoryQuarantineStore,
  SupervisorEngine } from "../src/index.js";
import { engine, snapshot, thresholds } from "./helpers.js";

test("emergency stop blocks effects but permits read-only safety work", () => {
  const store = new InMemoryEmergencyStopStore();
  const active = store.activate("operator stop", 100);
  active.active = false;
  assert.equal(store.get().active, true);
  const s = snapshot();
  s.emergencyStop = store.get();
  const supervisor = engine();
  assert.equal(supervisor.mayStart(s, "consequential", "executor-1"), false);
  for (const kind of ["diagnostic", "observation", "reconciliation", "forensic_read"] as const) {
    assert.equal(supervisor.mayStart(s, kind), true);
  }
  assert.ok(supervisor.tick(s).findings.some(f => f.code === "EMERGENCY_STOP_ACTIVE"));
  assert.equal(store.get().active, true);
});

test("quarantine blocks executor and is not auto-cleared", () => {
  const store = new InMemoryQuarantineStore();
  const entry = store.add({ id: "q-1", executorId: "executor-1", reason: "unknown rate",
    createdAt: 100, active: true });
  entry.active = false;
  const s = snapshot();
  s.quarantines = store.list();
  assert.equal(engine().mayStart(s, "consequential", "executor-1"), false);
  assert.equal(engine().mayStart(s, "consequential", "executor-2"), true);
  assert.equal(store.isQuarantined("executor-1"), true);
  engine().tick(s);
  assert.equal(store.isQuarantined("executor-1"), true);
});

test("supervisor exposes no authority, budget, executor or model operation", () => {
  const methods = Object.getOwnPropertyNames(SupervisorEngine.prototype);
  for (const forbidden of ["grant", "mint", "increaseBudget", "dispatch", "execute",
    "markCommitted", "plan", "infer", "retryEffect"]) {
    assert.equal(methods.includes(forbidden), false);
  }
  assert.throws(() => new SupervisorEngine({ ...thresholds, highUnknownRate: -1 }),
    /INVALID_SUPERVISOR_THRESHOLDS/);
});
