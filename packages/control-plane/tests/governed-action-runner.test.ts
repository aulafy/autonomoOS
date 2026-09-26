import assert from "node:assert/strict";
import test from "node:test";
import { fixture, placeId, sinkId } from "./helpers.js";

test("caller cannot change the sealed admitted request or replay its dispatch", async () => {
  const f = await fixture();
  const prepared = await f.runner.admit(f.request);
  prepared.request.intent.targetId = "unapproved";
  prepared.definition.executorId = "unregistered";
  assert.equal((await f.runner.dispatchPrepared(prepared)).status, "completed");
  assert.equal(f.executorCalls(), 1);
  await assert.rejects(() => f.runner.dispatchPrepared(prepared),
    /PREPARED_ACTION_NOT_ISSUED/);
});

test("full governed path records dispatch before executor and commits only after observation", async () => {
  const f = await fixture();
  const prepared = await f.runner.admit(f.request);
  assert.equal(f.effects.get(prepared.effectId)?.status, "prepared");
  assert.equal(prepared.admissionSnapshot.effectVersion,
    f.effects.get(prepared.effectId)?.version);
  assert.equal(prepared.admissionSnapshot.resourceGeneration,
    f.resources.get(placeId)?.generation);
  assert.equal(f.executorCalls(), 0);
  const result = await f.runner.dispatchPrepared(prepared);
  assert.equal(result.status, "completed");
  assert.equal(f.executorCalls(), 1);
  assert.equal(f.effects.get(prepared.effectId)?.status, "committed");
  assert.equal(f.budgets.getReservation(prepared.reservationId)?.status, "committed");
  assert.deepEqual(f.events.events.map(event => event.type), [
    "effect.prepared", "effect.dispatching", "effect.dispatch_reported", "effect.committed"
  ]);
});

test("revoked grant between admission and commit blocks executor", async () => {
  const f = await fixture();
  const prepared = await f.runner.admit(f.request);
  f.grant.revokedAt = 100;
  const result = await f.runner.dispatchPrepared(prepared);
  assert.equal(result.status, "blocked");
  assert.equal(result.reasonCode, "GRANT_REVOKED");
  assert.equal(f.executorCalls(), 0);
  assert.equal(f.effects.get(prepared.effectId)?.status, "failed");
  assert.equal(f.budgets.getReservation(prepared.reservationId)?.status, "released");
});

test("resource generation or fence changes before commit block executor", async () => {
  const generation = await fixture();
  const prepared = await generation.runner.admit(generation.request);
  generation.resources.update({ ...generation.resourceInput, generation: 2 }, 1);
  assert.equal((await generation.runner.dispatchPrepared(prepared)).reasonCode,
    "RESOURCE_GENERATION_CHANGED");
  assert.equal(generation.executorCalls(), 0);
  const fence = await fixture();
  const fenced = await fence.runner.admit(fence.request);
  fence.resourceLeases.revoke(fence.request.resourceLeaseId!, 1);
  assert.equal((await fence.runner.dispatchPrepared(fenced)).status, "blocked");
  assert.equal(fence.executorCalls(), 0);
});

test("emergency stop and expired reservation block after prepare", async () => {
  const emergency = await fixture();
  const prepared = await emergency.runner.admit(emergency.request);
  emergency.state.snapshot = () => ({ ...emergency.snapshot(), emergencyStop: { active: true } });
  assert.equal((await emergency.runner.dispatchPrepared(prepared)).reasonCode, "SUPERVISOR_STOP");
  assert.equal(emergency.executorCalls(), 0);
  const expired = await fixture();
  const pending = await expired.runner.admit(expired.request);
  expired.setNow(121);
  assert.equal((await expired.runner.dispatchPrepared(pending)).reasonCode,
    "BUDGET_RESERVATION_NOT_ACTIVE");
  assert.equal(expired.executorCalls(), 0);
});

test("executor success plus inconclusive observation is UNKNOWN and keeps budget hold", async () => {
  const f = await fixture();
  f.setObservationStatus("unknown");
  const prepared = await f.runner.admit(f.request);
  const result = await f.runner.dispatchPrepared(prepared);
  assert.equal(result.status, "unknown");
  assert.equal(f.effects.get(prepared.effectId)?.status, "unknown");
  assert.equal(f.budgets.getReservation(prepared.reservationId)?.status, "active");
});

test("observer exception after dispatch remains UNKNOWN", async () => {
  const f = await fixture();
  f.setObserverThrows(true);
  const prepared = await f.runner.admit(f.request);
  const result = await f.runner.dispatchPrepared(prepared);
  assert.equal(result.status, "unknown");
  assert.equal(f.budgets.getReservation(prepared.reservationId)?.status, "active");
});

test("composition history change after admission is re-evaluated and blocks", async () => {
  const f = await fixture({ compositionRule: { id: "TEST_SEQUENCE", version: "1",
    evaluate: history => ({ ruleId: "TEST_SEQUENCE", reason: "test",
      verdict: history.some(fact => fact.kind === "sensitive_read")
        ? "require_approval" : "allow" }) } });
  const prepared = await f.runner.admit(f.request);
  f.history.append({ id: "read-1", taskId: "task-1", kind: "sensitive_read",
    source: "trusted_control_event", sourceId: "event-1", occurredAt: 100,
    resourceIds: [placeId], metadata: {} });
  assert.equal((await f.runner.dispatchPrepared(prepared)).reasonCode,
    "COMPOSITION_APPROVAL_REQUIRED");
  assert.equal(f.executorCalls(), 0);
});

test("working-set version change triggers fresh flow evaluation", async () => {
  const f = await fixture({ requiresFlow: true });
  const prepared = await f.runner.admit(f.request);
  assert.equal(prepared.flowDecision?.workingSetVersion, 1);
  f.objects.addSource({ id: "new-public", taskId: "task-1", label: {
    confidentiality: "public", categories: [], jurisdictions: [], ownerPrincipalIds: [],
    releasable: true, metadata: {} }, origin: "human", createdAt: 100, metadata: {} });
  f.workingSet.add("task-1", "new-public", 1);
  assert.equal((await f.gate.check(prepared)).flow?.workingSetVersion, 2);
  assert.equal((await f.runner.dispatchPrepared(prepared)).status, "completed");
});

test("release approval expiry and sink generation change block before executor", async () => {
  const approval = await fixture({ requiresFlow: true });
  approval.objects.addSource({ id: "confidential", taskId: "task-1", label: {
    confidentiality: "confidential", categories: [], jurisdictions: [], ownerPrincipalIds: [],
    releasable: true, metadata: {} }, origin: "human", createdAt: 100, metadata: {} });
  approval.workingSet.add("task-1", "confidential", 1);
  approval.request.flowObjectIds = ["confidential"];
  approval.request.releaseApprovalId = "approval-1";
  approval.releaseApprovals.append({ id: "approval-1", taskId: "task-1", intentId: "intent-1",
    objectIds: ["confidential"], sinkId, workingSetVersion: 2,
    issuedAt: 90, expiresAt: 110, issuerId: "human-1" });
  const prepared = await approval.runner.admit(approval.request);
  approval.setNow(110);
  assert.equal((await approval.runner.dispatchPrepared(prepared)).reasonCode,
    "RELEASE_APPROVAL_REQUIRED");
  assert.equal(approval.executorCalls(), 0);
  const sink = await fixture({ requiresFlow: true });
  const pending = await sink.runner.admit(sink.request);
  const record = sink.resources.get(sinkId)!;
  sink.resources.update({ ...record, generation: 2 }, 1);
  assert.equal((await sink.runner.dispatchPrepared(pending)).reasonCode,
    "FLOW_SINK_GENERATION_CHANGED");
  assert.equal(sink.executorCalls(), 0);
});

test("quarantined executor after prepare is blocked", async () => {
  const f = await fixture();
  const prepared = await f.runner.admit(f.request);
  f.state.snapshot = () => ({ ...f.snapshot(), quarantines: [{ id: "q-1",
    executorId: "world-executor", reason: "unknown rate", createdAt: 100, active: true }] });
  assert.equal((await f.runner.dispatchPrepared(prepared)).reasonCode, "SUPERVISOR_STOP");
  assert.equal(f.executorCalls(), 0);
});
