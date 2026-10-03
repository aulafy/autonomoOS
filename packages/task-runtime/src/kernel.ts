import { createHash } from "node:crypto";
import type { TaskRuntimeEvent, TaskRuntimeState, SuccessCriterion, VerificationResult, Attempt, WorkUnit } from "./types.js";
const assert = (condition: unknown, reason: string): void => { if (!condition) throw new Error(reason); };
function text(value: unknown): asserts value is string {
  assert(typeof value === "string" && value.trim().length > 0 && value.length <= 10000 &&
    !["__proto__", "constructor", "prototype"].includes(value as string), "INVALID_TEXT");
}
function strings(values: unknown): asserts values is string[] {
  assert(Array.isArray(values), "INVALID_LIST");
  (values as unknown[]).forEach(text);
  assert(new Set(values as string[]).size === (values as string[]).length, "DUPLICATE_REFERENCE");
}
function criteria(values: SuccessCriterion[]): void {
  assert(Array.isArray(values) && values.length > 0, "CRITERIA_REQUIRED");
  strings(values.map(value => value.id));
  for (const value of values) {
    assert(["test", "http", "file", "schema", "observation", "human-approval", "custom"].includes(value.kind), "INVALID_CRITERION");
    switch (value.kind) {
      case "test": text(value.command); assert(Number.isInteger(value.expectedExitCode), "INVALID_EXIT_CODE"); if (value.cwdResource !== undefined) text(value.cwdResource); break;
      case "http": text(value.request.urlResource); assert(["GET", "HEAD", "POST"].includes(value.request.method), "INVALID_HTTP_METHOD"); if (value.expectedStatus !== undefined) assert(Number.isInteger(value.expectedStatus) && value.expectedStatus >= 100 && value.expectedStatus <= 599, "INVALID_HTTP_STATUS"); break;
      case "file": text(value.resource); assert(value.assertion !== undefined, "ASSERTION_REQUIRED"); break;
      case "schema": text(value.artifactRef); assert(value.schema !== undefined, "SCHEMA_REQUIRED"); break;
      case "observation": assert(value.predicate !== undefined, "PREDICATE_REQUIRED"); break;
      case "human-approval": text(value.approver); break;
      case "custom": text(value.verifierId); assert(value.input !== undefined, "VERIFIER_INPUT_REQUIRED"); break;
    }
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  assert(value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)), "INVALID_EVENT_VALUE");
  return JSON.stringify(value);
}
function evidence(state: TaskRuntimeState, taskId: string, refs: string[], attemptId?: string): void {
  strings(refs); assert(refs.length > 0, "EVIDENCE_REQUIRED");
  for (const id of refs) assert(state.references.some(ref => ref.kind === "evidence" && ref.id === id &&
    ref.taskId === taskId && (!attemptId || ref.attemptId === attemptId)), "EVIDENCE_SCOPE_MISMATCH");
}
function verification(state: TaskRuntimeState, taskId: string, required: SuccessCriterion[], results: VerificationResult[], attemptId?: string): "satisfied" | "unsatisfied" | "unknown" {
  assert(Array.isArray(results), "INVALID_VERIFICATION");
  strings(results.map(value => value.criterionId));
  assert(results.length === required.length && results.every(value => required.some(criterion => criterion.id === value.criterionId)), "CRITERIA_UNMAPPED");
  for (const result of results) {
    assert(["satisfied", "unsatisfied", "unknown"].includes(result.status), "INVALID_VERIFICATION_STATUS");
    evidence(state, taskId, result.evidenceRefs, attemptId);
  }
  return results.some(value => value.status === "unknown") ? "unknown" : results.some(value => value.status === "unsatisfied") ? "unsatisfied" : "satisfied";
}
const initial = (): TaskRuntimeState => ({ revision: 0, tasks: {}, workUnits: {}, attempts: {}, plans: [], references: [], verifications: [] });

/** Deterministic projection. Only a trusted host may submit verification/reconciliation events.
 * This kernel stores lifecycle truth; it executes no commands and grants no authority. */
export class TaskRuntimeKernel {
  private state = initial();
  private seen = new Map<string, { canonical: string; revision: number; projectionDigest: string }>();
  snapshot(): TaskRuntimeState { return structuredClone(this.state); }
  apply(input: TaskRuntimeEvent, expectedRevision: number): { eventId: string; revision: number; projectionDigest: string } {
    const event = structuredClone(input);
    text(event.id); text(event.taskId);
    assert(Number.isFinite(event.at) && event.at >= 0, "INVALID_TIMESTAMP");
    const encoded = canonical(event);
    const previous = this.seen.get(event.id);
    if (previous) {
      assert(previous.canonical === encoded, "EVENT_ID_CONFLICT");
      return { eventId: event.id, revision: previous.revision, projectionDigest: previous.projectionDigest };
    }
    assert(expectedRevision === this.state.revision, "REVISION_CONFLICT");
    // Validate against a private copy: rejected events cannot partially mutate state.
    const next = this.snapshot();
    this.reduce(next, event);
    next.revision++;
    this.state = next;
    const projectionDigest = createHash("sha256").update(canonical(next)).digest("hex");
    this.seen.set(event.id, { canonical: encoded, revision: next.revision, projectionDigest });
    return { eventId: event.id, revision: next.revision, projectionDigest };
  }
  private reduce(state: TaskRuntimeState, event: TaskRuntimeEvent): void {
    if (event.type === "GlobalTaskCreated") {
      assert(!Object.hasOwn(state.tasks, event.taskId), "TASK_EXISTS");
      text(event.goal); text(event.owner); criteria(event.successCriteria);
      if (event.budgetRef !== undefined) text(event.budgetRef);
      if (event.contextRootRef !== undefined) text(event.contextRootRef);
      state.tasks[event.taskId] = { id: event.taskId, goal: event.goal, owner: event.owner,
        successCriteria: event.successCriteria, status: "created", workUnitIds: [], planVersion: 0,
        createdAt: event.at, updatedAt: event.at,
        ...(event.budgetRef ? { budgetRef: event.budgetRef } : {}),
        ...(event.contextRootRef ? { contextRootRef: event.contextRootRef } : {}) };
      return;
    }
    const task = state.tasks[event.taskId];
    assert(Object.hasOwn(state.tasks, event.taskId) && task && !["completed", "failed", "cancelled"].includes(task.status), "TASK_NOT_MUTABLE");
    assert(event.at >= task.updatedAt, "TIME_REGRESSION");
    task.updatedAt = event.at;
    if (event.type === "GlobalTaskPlanningStarted") {
      assert(["created", "ready", "blocked"].includes(task.status), "INVALID_TASK_TRANSITION");
      assert(task.workUnitIds.every(id => !state.workUnits[id]!.activeAttemptId), "ACTIVE_ATTEMPT");
      task.status = "planning"; return;
    }
    if (event.type === "PlanCommitted") {
      assert(task.status === "planning" && event.planVersion === task.planVersion + 1, "INVALID_PLAN_VERSION");
      assert(Array.isArray(event.workUnits) && event.workUnits.length > 0, "EMPTY_PLAN");
      strings(event.workUnits.map(unit => unit.id));
      for (const unit of event.workUnits) {
        text(unit.id); text(unit.title); text(unit.objective); strings(unit.dependencies); criteria(unit.successCriteria);
        assert(!Object.hasOwn(state.workUnits, unit.id), "WORK_UNIT_EXISTS");
        assert(Array.isArray(unit.requiredCapabilities) && Array.isArray(unit.constraints) && Array.isArray(unit.expectedArtifacts), "INVALID_WORK_UNIT");
        for (const requirement of unit.requiredCapabilities) {
          text(requirement.capability);
          if (requirement.minimumLevel !== undefined) assert(Number.isFinite(requirement.minimumLevel) && requirement.minimumLevel >= 0 && requirement.minimumLevel <= 1, "INVALID_CAPABILITY_LEVEL");
        }
        for (const constraint of unit.constraints) { text(constraint.id); text(constraint.ruleRef); }
        for (const artifact of unit.expectedArtifacts) { text(artifact.id); text(artifact.kind); if (artifact.resourceRef !== undefined) text(artifact.resourceRef); }
        state.workUnits[unit.id] = { ...unit, taskId: task.id, status: "planned", attemptIds: [], createdAt: event.at, updatedAt: event.at };
      }
      const visiting = new Set<string>(), visited = new Set<string>();
      const visit = (id: string): void => {
        assert(!visiting.has(id), "CYCLIC_PLAN"); if (visited.has(id)) return;
        const unit = state.workUnits[id]; assert(unit?.taskId === task.id, "DEPENDENCY_SCOPE_MISMATCH");
        visiting.add(id); unit.dependencies.forEach(visit); visiting.delete(id); visited.add(id);
      };
      event.workUnits.forEach(unit => visit(unit.id));
      task.workUnitIds.push(...event.workUnits.map(unit => unit.id));
      task.planVersion = event.planVersion; task.status = "ready";
      state.plans.push({ taskId: task.id, version: event.planVersion, workUnitIds: event.workUnits.map(unit => unit.id) });
      this.refresh(state, task.id); return;
    }
    if (event.type === "DecisionRecorded" || event.type === "EvidenceRecorded") {
      text(event.referenceId);
      if (event.attemptId) assert(state.attempts[event.attemptId]?.taskId === task.id, "ATTEMPT_SCOPE_MISMATCH");
      assert(!state.references.some(ref => ref.id === event.referenceId), "REFERENCE_EXISTS");
      state.references.push({ taskId: task.id, ...(event.attemptId ? { attemptId: event.attemptId } : {}), kind: event.type === "EvidenceRecorded" ? "evidence" : "decision", id: event.referenceId }); return;
    }
    if (event.type === "GlobalTaskCompleted" || event.type === "GlobalTaskVerificationCompleted") {
      assert(task.status === "verifying" && task.workUnitIds.length > 0 && task.workUnitIds.every(id => state.workUnits[id]!.status === "succeeded"), "WORK_NOT_VERIFIED");
      const outcome = verification(state, task.id, task.successCriteria, event.results);
      if (event.type === "GlobalTaskCompleted") assert(outcome === "satisfied", "TASK_CRITERIA_NOT_SATISFIED");
      state.verifications.push({ taskId: task.id, results: event.results });
      task.status = outcome === "satisfied" ? "completed" : outcome === "unknown" ? "unknown" : "blocked"; return;
    }
    if (event.type === "GlobalTaskCancelled") {
      assert(!task.workUnitIds.some(id => state.workUnits[id]!.activeAttemptId), "ACTIVE_ATTEMPT");
      task.status = "cancelled";
      for (const id of task.workUnitIds) if (state.workUnits[id]!.status !== "succeeded") state.workUnits[id]!.status = "cancelled";
      return;
    }
    if (event.type === "AttemptCreated") {
      const unit = state.workUnits[event.workUnitId];
      assert(unit?.taskId === task.id && unit.status === "ready" && !unit.activeAttemptId, "WORK_UNIT_NOT_READY");
      assert(["ready", "running", "waiting", "verifying"].includes(task.status), "TASK_NOT_RUNNABLE");
      assert(unit.dependencies.every(id => state.workUnits[id]!.status === "succeeded"), "DEPENDENCY_UNSATISFIED");
      text(event.attemptId); text(event.providerId); text(event.actorId); text(event.dispatchFingerprint);
      assert(!Object.hasOwn(state.attempts, event.attemptId), "ATTEMPT_EXISTS");
      state.attempts[event.attemptId] = { id: event.attemptId, taskId: task.id, workUnitId: unit.id, providerId: event.providerId, actorId: event.actorId, dispatchFingerprint: event.dispatchFingerprint, status: "created" };
      unit.attemptIds.push(event.attemptId); unit.activeAttemptId = event.attemptId; unit.status = "running"; unit.updatedAt = event.at;
      task.status = "running"; return;
    }
    assert("attemptId" in event, "UNKNOWN_EVENT");
    const attempt = state.attempts[(event as { attemptId: string }).attemptId];
    assert(Object.hasOwn(state.attempts, (event as { attemptId: string }).attemptId) && attempt?.taskId === task.id, "ATTEMPT_SCOPE_MISMATCH");
    const unit = state.workUnits[attempt.workUnitId]!;
    assert(unit.activeAttemptId === attempt.id, "STALE_ATTEMPT");
    unit.updatedAt = event.at;
    const move = (from: string[], to: Attempt["status"]): void => { assert(from.includes(attempt.status), "INVALID_ATTEMPT_TRANSITION"); attempt.status = to; };
    switch (event.type) {
      case "ProviderQuestionReceived":
      case "ProviderEscalationReceived": {
        assert(event.providerId === attempt.providerId && attempt.providerExecutionRef?.provider === event.providerId, "PROVIDER_SCOPE_MISMATCH");
        assert(["running", "unknown", "reported", "verifying"].includes(attempt.status), "INVALID_ATTEMPT_TRANSITION");
        text(event.providerMessageId); text(event.contentRef);
        const signal = { taskId: task.id, attemptId: attempt.id, providerId: event.providerId, providerMessageId: event.providerMessageId,
          contentRef: event.contentRef, kind: event.type === "ProviderQuestionReceived" ? "question" as const : "escalation" as const };
        const previous = state.providerSignals?.find(item => item.providerId === signal.providerId && item.providerMessageId === signal.providerMessageId);
        if (previous) assert(canonical(previous) === canonical(signal), "PROVIDER_MESSAGE_ID_CONFLICT");
        else (state.providerSignals ??= []).push(signal);
        // Recording a question is not authorization, reconciliation or success.
        break;
      }
      case "AttemptReserved": move(["created"], "reserved"); break;
      case "AttemptDispatchStarted": move(["reserved"], "dispatching"); attempt.startedAt = event.at; break;
      case "AttemptDispatched":
        assert(event.providerRef.provider === attempt.providerId, "PROVIDER_SCOPE_MISMATCH");
        for (const value of Object.values(event.providerRef)) {
          if (typeof value === "object" && value) Object.values(value).forEach(text); else text(value);
        }
        move(["dispatching"], "running"); attempt.providerExecutionRef = event.providerRef; break;
      case "AttemptRunning": move(["dispatching", "running"], "running"); break;
      case "AttemptUnknown": move(["dispatching", "running", "reported", "verifying"], "unknown"); unit.status = "unknown"; task.status = "unknown"; break;
      case "AttemptProviderReported":
        assert(["succeeded", "failed"].includes(event.outcome), "INVALID_OUTCOME");
        move(["dispatching", "running"], "reported"); attempt.reportedAt = event.at;
        attempt.providerReportedOutcome = event.outcome;
        unit.status = "verifying"; task.status = "verifying"; break;
      case "VerificationStarted": move(["reported"], "verifying"); break;
      case "VerificationCompleted": {
        assert(attempt.status === "verifying", "VERIFICATION_NOT_STARTED");
        const result = verification(state, task.id, unit.successCriteria, event.results, attempt.id);
        state.verifications.push({ taskId: task.id, attemptId: attempt.id, results: event.results });
        attempt.status = result === "satisfied" ? "succeeded" : result === "unknown" ? "unknown" : "failed";
        unit.status = attempt.status === "succeeded" ? "succeeded" : attempt.status === "unknown" ? "unknown" : "failed";
        if (result !== "unknown") { attempt.finishedAt = event.at; delete unit.activeAttemptId; }
        task.status = result === "unknown" ? "unknown" : result === "unsatisfied" ? "blocked" : "verifying";
        this.refresh(state, task.id); break;
      }
      case "ReconciliationCompleted":
        assert(attempt.status === "unknown", "RECONCILIATION_NOT_REQUIRED");
        evidence(state, task.id, event.evidenceRefs, attempt.id);
        if (event.outcome === "not-executed") {
          attempt.status = "failed"; attempt.finishedAt = event.at; delete unit.activeAttemptId; unit.status = "ready"; task.status = "ready";
        } else if (event.outcome === "running") { attempt.status = "running"; unit.status = "running"; task.status = "running"; }
        else if (event.outcome === "reported-success") { attempt.status = "reported"; attempt.reportedAt = event.at; unit.status = "verifying"; task.status = "verifying"; }
        else throw new Error("INVALID_RECONCILIATION");
        break;
      default: throw new Error("UNKNOWN_EVENT");
    }
    // An unrelated successful attempt must never erase another attempt's UNKNOWN.
    if (task.workUnitIds.some(id => state.workUnits[id]!.status === "unknown")) task.status = "unknown";
  }
  private refresh(state: TaskRuntimeState, taskId: string): void {
    for (const unit of Object.values(state.workUnits).filter(unit => unit.taskId === taskId)) {
      if (unit.status === "planned" && unit.dependencies.every(id => state.workUnits[id]!.status === "succeeded")) unit.status = "ready";
      else if (unit.status === "planned" && unit.dependencies.some(id => ["failed", "cancelled"].includes(state.workUnits[id]!.status))) unit.status = "blocked";
    }
  }
}
