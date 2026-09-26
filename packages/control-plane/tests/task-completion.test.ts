import assert from "node:assert/strict";
import test from "node:test";
import { TaskCompletionEvaluator } from "../src/index.js";
import { fixture } from "./helpers.js";

test("completion requires a committed required effect and trusted acceptance observation", async () => {
  const f = await fixture();
  const evaluator = new TaskCompletionEvaluator(f.contracts, f.effects, f.observations,
    f.observers, f.policy);
  const prepared = await f.runner.admit(f.request);
  const input = { taskId: "task-1", contractId: "contract-1",
    requiredEffectIds: [prepared.effectId], maxObservationAgeMs: 100,
    pendingApprovalCount: 0, acceptanceEvidence: [{ criterion: "agent at meeting room",
      effectId: prepared.effectId, riskClass: "R1" as const }] };
  assert.equal((await evaluator.evaluate(input)).reasonCode, "UNSETTLED_EFFECT");
  await f.runner.dispatchPrepared(prepared);
  assert.deepEqual(await evaluator.evaluate(input),
    { complete: true, reasonCode: "TASK_ACCEPTED" });
  assert.equal((await evaluator.evaluate({ ...input, pendingApprovalCount: 1 })).reasonCode,
    "APPROVAL_PENDING");
  assert.equal((await evaluator.evaluate({ ...input, acceptanceEvidence: [] })).reasonCode,
    "ACCEPTANCE_CRITERIA_UNMAPPED");
  f.setNow(250);
  assert.equal((await evaluator.evaluate(input)).reasonCode, "ACCEPTANCE_NOT_OBSERVED");
});

test("UNKNOWN effect cannot complete a task", async () => {
  const f = await fixture();
  f.setObservationStatus("unknown");
  const prepared = await f.runner.admit(f.request);
  await f.runner.dispatchPrepared(prepared);
  const evaluator = new TaskCompletionEvaluator(f.contracts, f.effects, f.observations,
    f.observers, f.policy);
  assert.equal((await evaluator.evaluate({ taskId: "task-1", contractId: "contract-1",
    requiredEffectIds: [prepared.effectId], maxObservationAgeMs: 100,
    pendingApprovalCount: 0, acceptanceEvidence: [{ criterion: "agent at meeting room",
      effectId: prepared.effectId, riskClass: "R1" }] })).reasonCode, "UNSETTLED_EFFECT");
});
