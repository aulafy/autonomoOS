import test from "node:test";
import assert from "node:assert/strict";
import { TaskRuntimeKernel, type TaskRuntimeEvent, type WorkUnitDefinition } from "../src/index.js";
const criterion = { id: "criterion", kind: "custom" as const, input: null, verifierId: "host:test" };
const unit = (id: string, dependencies: string[] = []): WorkUnitDefinition => ({ id, title: id, objective: "Verify a fixture", dependencies,
  requiredCapabilities: [{ capability: "test.run" }], constraints: [], expectedArtifacts: [], successCriteria: [criterion] });
function setup(units = [unit("w1")]) {
  const kernel = new TaskRuntimeKernel(); let sequence = 0;
  const send = (payload: Omit<TaskRuntimeEvent, "id" | "taskId" | "at"> | Record<string, unknown>) => {
    const event = { id: `e${++sequence}`, taskId: "t", at: sequence, ...payload } as TaskRuntimeEvent;
    return kernel.apply(event, kernel.snapshot().revision);
  };
  send({ type: "GlobalTaskCreated", goal: "Build and verify", owner: "owner", successCriteria: [criterion] });
  send({ type: "GlobalTaskPlanningStarted" }); send({ type: "PlanCommitted", planVersion: 1, workUnits: units });
  const start = (attemptId = "a", workUnitId = "w1") => {
    send({ type: "AttemptCreated", attemptId, workUnitId, providerId: "orca", actorId: "codex", dispatchFingerprint: attemptId });
    send({ type: "AttemptReserved", attemptId }); send({ type: "AttemptDispatchStarted", attemptId });
  };
  const report = (attemptId = "a") => send({ type: "AttemptProviderReported", attemptId, outcome: "succeeded" });
  const verify = (status: "satisfied" | "unsatisfied" | "unknown", attemptId = "a") => {
    send({ type: "VerificationStarted", attemptId });
    send({ type: "EvidenceRecorded", attemptId, referenceId: `proof-${attemptId}` });
    send({ type: "VerificationCompleted", attemptId, results: [{ criterionId: "criterion", evidenceRefs: [`proof-${attemptId}`], status }] });
  };
  return { kernel, send, start, report, verify };
}

test("task creation and detached snapshots", () => {
  const { kernel } = setup(); const snapshot = kernel.snapshot();
  assert.equal(snapshot.tasks.t!.goal, "Build and verify"); assert.equal(snapshot.tasks.t!.planVersion, 1);
  snapshot.tasks.t!.goal = "changed"; assert.equal(kernel.snapshot().tasks.t!.goal, "Build and verify");
});
test("invalid transitions and revisions leave the projection unchanged", () => {
  const { kernel, send } = setup(); const before = kernel.snapshot();
  assert.throws(() => send({ type: "AttemptReserved", attemptId: "missing" }), /SCOPE/);
  assert.throws(() => kernel.apply({ id: "invalid", taskId: "t", at: 5, type: "GlobalTaskPlanningStarted" }, 0), /REVISION/);
  assert.deepEqual(kernel.snapshot(), before);
});
test("cyclic and foreign dependencies cannot partially install a plan", () => {
  for (const units of [[unit("w1", ["w2"]), unit("w2", ["w1"])], [unit("w1", ["missing"])]]) {
    const kernel = new TaskRuntimeKernel();
    kernel.apply({ id: "e1", taskId: "t", at: 1, type: "GlobalTaskCreated", goal: "goal", owner: "owner", successCriteria: [criterion] }, 0);
    kernel.apply({ id: "e2", taskId: "t", at: 2, type: "GlobalTaskPlanningStarted" }, 1);
    const before = kernel.snapshot();
    assert.throws(() => kernel.apply({ id: "e3", taskId: "t", at: 3, type: "PlanCommitted", planVersion: 1, workUnits: units }, 2));
    assert.deepEqual(kernel.snapshot(), before);
  }
});
test("dependencies never start early and a work unit has one active attempt", () => {
  const { kernel, start, report, verify } = setup([unit("w1"), unit("w2", ["w1"])]);
  assert.throws(() => start("early", "w2"), /NOT_READY/);
  start(); assert.throws(() => start("duplicate"), /NOT_READY/);
  report(); verify("satisfied");
  assert.equal(kernel.snapshot().workUnits.w2!.status, "ready"); start("a2", "w2");
});
test("provider done is a report, independent evidence completes work", () => {
  const { kernel, send, start, report, verify } = setup(); start(); report();
  assert.equal(kernel.snapshot().attempts.a!.status, "reported"); assert.equal(kernel.snapshot().workUnits.w1!.status, "verifying");
  assert.throws(() => send({ type: "GlobalTaskCompleted", results: [] }), /WORK_NOT_VERIFIED/);
  verify("satisfied"); assert.equal(kernel.snapshot().tasks.t!.status, "verifying");
  send({ type: "GlobalTaskCompleted", results: [{ criterionId: "criterion", evidenceRefs: ["proof-a"], status: "satisfied" }] });
  assert.equal(kernel.snapshot().tasks.t!.status, "completed");
  assert.throws(() => send({ type: "GlobalTaskPlanningStarted" }), /NOT_MUTABLE/);
});
test("false positive worker report cannot complete a failing criterion", () => {
  const { kernel, send, start, report, verify } = setup(); start(); report(); verify("unsatisfied");
  assert.equal(kernel.snapshot().workUnits.w1!.status, "failed"); assert.equal(kernel.snapshot().tasks.t!.status, "blocked");
  assert.throws(() => send({ type: "GlobalTaskCompleted", results: [] }), /WORK_NOT_VERIFIED/);
});
test("unknown is preserved and prohibits replacement until reconciliation", () => {
  const { kernel, send, start } = setup(); start(); send({ type: "AttemptUnknown", attemptId: "a" });
  assert.throws(() => start("replacement"), /NOT_READY/);
  assert.throws(() => send({ type: "AttemptProviderReported", attemptId: "a", outcome: "succeeded" }), /TRANSITION/);
  assert.throws(() => send({ type: "ReconciliationCompleted", attemptId: "a", outcome: "not-executed", evidenceRefs: ["invented"] }), /SCOPE/);
  assert.equal(kernel.snapshot().attempts.a!.status, "unknown");
  send({ type: "EvidenceRecorded", attemptId: "a", referenceId: "not-executed-proof" });
  send({ type: "ReconciliationCompleted", attemptId: "a", outcome: "not-executed", evidenceRefs: ["not-executed-proof"] });
  start("replacement");
  assert.deepEqual(kernel.snapshot().workUnits.w1!.attemptIds, ["a", "replacement"]);
  assert.throws(() => send({ type: "AttemptRunning", attemptId: "a" }), /STALE/);
});
test("duplicate events are idempotent; conflicting reuse is rejected", () => {
  const kernel = new TaskRuntimeKernel();
  const event: TaskRuntimeEvent = { id: "create", taskId: "t", at: 1, type: "GlobalTaskCreated", goal: "goal", owner: "owner", successCriteria: [criterion] };
  assert.deepEqual(kernel.apply(event, 0), kernel.apply(event, 0));
  assert.equal(kernel.snapshot().revision, 1);
  assert.throws(() => kernel.apply({ ...event, goal: "other" }, 1), /EVENT_ID_CONFLICT/);
});
test("evidence belongs to the exact attempt and criteria must be complete", () => {
  const { kernel, send, start, report } = setup(); start(); report(); send({ type: "VerificationStarted", attemptId: "a" });
  send({ type: "EvidenceRecorded", referenceId: "unscoped" });
  assert.throws(() => send({ type: "VerificationCompleted", attemptId: "a", results: [{ criterionId: "criterion", evidenceRefs: ["unscoped"], status: "satisfied" }] }), /SCOPE/);
  assert.throws(() => send({ type: "VerificationCompleted", attemptId: "a", results: [] }), /UNMAPPED/);
  assert.equal(kernel.snapshot().attempts.a!.status, "verifying");
});
test("other successful work cannot clear an unknown attempt", () => {
  const { kernel, send, start, report, verify } = setup([unit("w1"), unit("w2")]);
  start("a", "w1"); start("b", "w2"); send({ type: "AttemptUnknown", attemptId: "a" });
  report("b"); verify("satisfied", "b"); assert.equal(kernel.snapshot().tasks.t!.status, "unknown");
});
test("provider questions and escalations record exact identity without clearing UNKNOWN", () => {
  const { kernel, send, start } = setup(); start();
  assert.equal(Object.hasOwn(kernel.snapshot(), "providerSignals"), false);
  send({ type: "AttemptDispatched", attemptId: "a", providerRef: { provider: "orca", externalAttemptId: "dispatch" } });
  send({ type: "AttemptUnknown", attemptId: "a" });
  const payload = { type: "ProviderQuestionReceived", attemptId: "a", providerId: "orca", providerMessageId: "question", contentRef: "provider-cache:question" };
  send(payload); send(payload);
  send({ ...payload, type: "ProviderEscalationReceived", providerMessageId: "escalation", contentRef: "provider-cache:escalation" });
  assert.equal(kernel.snapshot().providerSignals!.length, 2);
  assert.equal(kernel.snapshot().attempts.a!.status, "unknown");
  assert.equal(kernel.snapshot().tasks.t!.status, "unknown");
  const before = kernel.snapshot();
  assert.throws(() => send({ ...payload, contentRef: "changed" }), /MESSAGE_ID_CONFLICT/);
  assert.throws(() => send({ ...payload, providerId: "other" }), /PROVIDER_SCOPE_MISMATCH/);
  assert.deepEqual(kernel.snapshot(), before);
});

test("failed dependency blocks downstream work without dispatch", () => {
  const { kernel, start, report, verify } = setup([unit("w1"), unit("w2", ["w1"])]);
  start(); report(); verify("unsatisfied");
  assert.equal(kernel.snapshot().workUnits.w2!.status, "blocked");
  assert.throws(() => start("a2", "w2"), /NOT_READY/);
});

test("unknown verification preserves active identity and cannot be called failure", () => {
  const { kernel, start, report, verify } = setup(); start(); report(); verify("unknown");
  assert.equal(kernel.snapshot().attempts.a!.status, "unknown");
  assert.equal(kernel.snapshot().workUnits.w1!.activeAttemptId, "a");
  assert.throws(() => start("replacement"), /NOT_READY/);
});

test("decisions and duplicate receipts remain stable across deterministic replay", () => {
  const first = new TaskRuntimeKernel(), second = new TaskRuntimeKernel();
  const events: TaskRuntimeEvent[] = [
    { id: "e1", taskId: "t", at: 1, type: "GlobalTaskCreated", goal: "goal", owner: "owner", successCriteria: [criterion] },
    { id: "e2", taskId: "t", at: 2, type: "DecisionRecorded", referenceId: "decision" }
  ];
  const receipts = events.map(event => first.apply(event, first.snapshot().revision));
  events.forEach((event, index) => assert.deepEqual(second.apply(event, second.snapshot().revision), receipts[index]));
  assert.deepEqual(first.snapshot(), second.snapshot());
  assert.deepEqual(second.apply(events[0]!, 0), receipts[0]);
});

for (const status of ['satisfied', 'unsatisfied', 'unknown'] as const) test(`global criteria retain ${status} outcome separately from successful units`, () => {
  const {kernel,send,start,report,verify}=setup();start();report();verify('satisfied');
  send({type:'EvidenceRecorded',referenceId:'global-evidence'});
  send({type:'GlobalTaskVerificationCompleted',results:[{criterionId:'criterion',evidenceRefs:['global-evidence'],status}]});
  const state=kernel.snapshot();
  assert.equal(state.tasks.t!.status,status==='satisfied'?'completed':status==='unknown'?'unknown':'blocked');
  assert.equal(state.workUnits.w1!.status,'succeeded');
  assert.equal(state.verifications.at(-1)!.results[0]!.status,status);
  assert.equal(state.verifications.at(-1)!.attemptId,undefined);
});
test('global verification cannot bypass unfinished work or missing scoped evidence',()=>{
  const {kernel,send,start,report,verify}=setup();start();report();
  assert.throws(()=>send({type:'GlobalTaskVerificationCompleted',results:[]}),/WORK_NOT_VERIFIED/);
  verify('satisfied');const before=kernel.snapshot();
  assert.throws(()=>send({type:'GlobalTaskVerificationCompleted',results:[{criterionId:'criterion',evidenceRefs:['missing'],status:'satisfied'}]}),/EVIDENCE_SCOPE_MISMATCH/);
  assert.deepEqual(kernel.snapshot(),before);
});
