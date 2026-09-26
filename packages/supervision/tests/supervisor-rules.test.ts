import assert from "node:assert/strict";
import test from "node:test";
import { effect, engine, snapshot } from "./helpers.js";

test("deadlines, stalls, leases and budgets request only restrictive actions", () => {
  const s = snapshot();
  s.tasks.push({ id: "task-1", status: "running", deadlineAt: 100,
    lastProgressAt: 80, requiredEffectIds: [] });
  s.authorityLeases.push({ id: "authority-1", taskId: "task-1", active: true, expiresAt: 100 });
  s.resourceLeases.push({ id: "resource-1", taskId: "task-1", active: true, expiresAt: 100 });
  s.budgets.push({ id: "budget-1", taskId: "task-1", active: true,
    expiresAt: 200, exhausted: true });
  const decision = engine().tick(s);
  for (const code of ["TASK_DEADLINE_EXCEEDED", "TASK_STALLED", "AUTHORITY_LEASE_EXPIRED",
    "RESOURCE_LEASE_EXPIRED", "BUDGET_EXHAUSTED"]) {
    assert.ok(decision.findings.some(f => f.code === code), code);
  }
  assert.ok(decision.actions.some(a => a.kind === "cancel_task"));
  assert.ok(decision.actions.some(a => a.kind === "stop_before_dispatch"));
});

test("preparing timeout differs from dispatching uncertainty", () => {
  const s = snapshot();
  s.effects.push(effect("preparing"), { ...effect("dispatching"), id: "effect-2" });
  const decision = engine().tick(s);
  assert.ok(decision.findings.some(f => f.code === "EFFECT_PREPARING_STUCK"));
  assert.ok(decision.findings.some(f => f.code === "EFFECT_OUTCOME_UNCERTAIN"));
  assert.ok(decision.actions.some(a => a.kind === "request_safe_cleanup"));
  assert.ok(decision.actions.some(a => a.kind === "request_reconciliation"));
  assert.equal(decision.actions.map(a => a.kind as string).includes("mark_effect_failed"), false);
});

test("UNKNOWN without a job, due job and exhausted job are distinct", () => {
  const s = snapshot();
  s.effects.push(effect("unknown"));
  assert.ok(engine().tick(s).findings.some(f => f.code === "RECONCILIATION_MISSING"));
  s.reconciliations.push({ id: "job-1", effectId: "effect-1", status: "queued",
    nextAttemptAt: 100, attempts: 0, maxAttempts: 2 });
  const due = engine().tick(s);
  assert.equal(due.findings.some(f => f.code === "RECONCILIATION_MISSING"), false);
  assert.ok(due.findings.some(f => f.code === "RECONCILIATION_DUE"));
  s.reconciliations[0].status = "exhausted";
  assert.ok(engine().tick(s).findings.some(f => f.code === "RECONCILIATION_EXHAUSTED"));
});

test("component failures, backlog, rate and mismatches are surfaced", () => {
  const s = snapshot();
  s.components.push({ id: "executor-1", kind: "executor", healthy: false });
  s.policyAvailable = false;
  s.eventStoreAvailable = false;
  s.effects.push(effect("unknown"), { ...effect("unknown"), id: "effect-2" },
    { ...effect("committed"), id: "effect-3" });
  s.reconciliations.push({ id: "job-3", effectId: "effect-3", status: "queued",
    nextAttemptAt: 100, attempts: 0, maxAttempts: 2 });
  s.unknownRateByExecutor["executor-1"] = 0.6;
  const codes = engine().tick(s).findings.map(f => f.code);
  for (const code of ["COMPONENT_UNHEALTHY", "POLICY_UNAVAILABLE",
    "EVENT_STORE_UNAVAILABLE", "UNKNOWN_BACKLOG_TOO_LARGE", "EXECUTOR_HIGH_UNKNOWN_RATE",
    "RECONCILIATION_EFFECT_MISMATCH", "COMMITTED_WITHOUT_OBSERVATION"]) {
    assert.ok(codes.includes(code), code);
  }
});

test("completed task with unresolved required effect is a violation", () => {
  const s = snapshot();
  s.tasks.push({ id: "task-1", status: "completed", deadlineAt: 200,
    lastProgressAt: 100, requiredEffectIds: ["effect-1"] });
  s.effects.push(effect("unknown"));
  assert.ok(engine().tick(s).findings.some(f => f.code === "COMPLETED_WITH_UNRESOLVED_EFFECT"));
  s.effects[0].effectiveOutcome = "committed";
  assert.equal(engine().tick(s).findings.some(f => f.code === "COMPLETED_WITH_UNRESOLVED_EFFECT"),
    false);
});
