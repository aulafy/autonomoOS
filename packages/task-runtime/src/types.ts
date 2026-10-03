export type GlobalTaskStatus = "created" | "planning" | "ready" | "running" | "waiting" | "verifying" | "completed" | "failed" | "blocked" | "unknown" | "cancelled";
export type WorkUnitStatus = "planned" | "ready" | "running" | "waiting" | "verifying" | "succeeded" | "failed" | "blocked" | "unknown" | "cancelled";
export type AttemptStatus = "created" | "reserved" | "dispatching" | "running" | "reported" | "verifying" | "succeeded" | "failed" | "unknown" | "cancelled";
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
/** Declarative assertions; execution and interpretation belong to AW2-7 governance/verifiers. */
export type SuccessCriterion =
  | { id: string; kind: "test"; command: string; cwdResource?: string; expectedExitCode: number }
  | { id: string; kind: "http"; request: { method: "GET" | "HEAD" | "POST"; urlResource: string }; expectedStatus?: number; bodyAssertion?: JsonValue }
  | { id: string; kind: "file"; resource: string; assertion: JsonValue }
  | { id: string; kind: "schema"; artifactRef: string; schema: JsonValue }
  | { id: string; kind: "observation"; predicate: JsonValue }
  | { id: string; kind: "human-approval"; approver: string }
  | { id: string; kind: "custom"; verifierId: string; input: JsonValue };
export interface CapabilityRequirement { capability: string; minimumLevel?: number }
export interface Constraint { id: string; ruleRef: string }
export interface ArtifactExpectation { id: string; kind: string; resourceRef?: string }
export interface GlobalTask {
  id: string; goal: string; owner: string; status: GlobalTaskStatus;
  successCriteria: SuccessCriterion[]; workUnitIds: string[]; budgetRef?: string;
  contextRootRef?: string; planVersion: number; createdAt: number; updatedAt: number;
}
export interface WorkUnit {
  id: string; taskId: string; title: string; objective: string; dependencies: string[];
  requiredCapabilities: CapabilityRequirement[]; constraints: Constraint[];
  expectedArtifacts: ArtifactExpectation[]; successCriteria: SuccessCriterion[];
  status: WorkUnitStatus; activeAttemptId?: string; attemptIds: string[]; createdAt: number; updatedAt: number;
}
export interface ProviderExecutionRef {
  provider: string; externalRunId?: string; externalTaskId?: string;
  externalAttemptId?: string; opaque?: Record<string, string>;
}
export interface Attempt {
  id: string; taskId: string; workUnitId: string; providerId: string; actorId: string;
  status: AttemptStatus; dispatchFingerprint: string; providerExecutionRef?: ProviderExecutionRef;
  providerReportedOutcome?: "succeeded" | "failed";
  startedAt?: number; reportedAt?: number; finishedAt?: number;
}
export type WorkUnitDefinition = Pick<WorkUnit, "id" | "title" | "objective" | "dependencies" | "requiredCapabilities" | "constraints" | "expectedArtifacts" | "successCriteria">;
export interface VerificationResult { criterionId: string; evidenceRefs: string[]; status: "satisfied" | "unsatisfied" | "unknown" }
interface EventBase { id: string; taskId: string; at: number }
export type TaskRuntimeEvent = EventBase & (
  | { type: "GlobalTaskCreated"; goal: string; owner: string; successCriteria: SuccessCriterion[]; budgetRef?: string; contextRootRef?: string }
  | { type: "GlobalTaskPlanningStarted" }
  | { type: "PlanCommitted"; planVersion: number; workUnits: WorkUnitDefinition[] }
  | { type: "AttemptCreated"; workUnitId: string; attemptId: string; providerId: string; actorId: string; dispatchFingerprint: string }
  | { type: "AttemptReserved" | "AttemptDispatchStarted" | "AttemptRunning" | "AttemptUnknown"; attemptId: string }
  | { type: "AttemptDispatched"; attemptId: string; providerRef: ProviderExecutionRef }
  | { type: "AttemptProviderReported"; attemptId: string; outcome: "succeeded" | "failed" }
  | { type: "ProviderQuestionReceived" | "ProviderEscalationReceived"; attemptId: string; providerId: string; providerMessageId: string; contentRef: string }
  | { type: "VerificationStarted"; attemptId: string }
  | { type: "VerificationCompleted"; attemptId: string; results: VerificationResult[] }
  | { type: "ReconciliationCompleted"; attemptId: string; evidenceRefs: string[]; outcome: "running" | "reported-success" | "not-executed" }
  | { type: "DecisionRecorded" | "EvidenceRecorded"; referenceId: string; attemptId?: string }
  | { type: "GlobalTaskCompleted" | "GlobalTaskVerificationCompleted"; results: VerificationResult[] }
  | { type: "GlobalTaskCancelled" }
);
export interface TaskRuntimeState {
  revision: number; tasks: Record<string, GlobalTask>; workUnits: Record<string, WorkUnit>;
  attempts: Record<string, Attempt>; plans: Array<{ taskId: string; version: number; workUnitIds: string[] }>;
  verifications: Array<{ taskId: string; attemptId?: string; results: VerificationResult[] }>;
  references: Array<{ taskId: string; attemptId?: string; kind: "decision" | "evidence"; id: string }>;
  /** Lazy projection field preserves digests when replaying older AW2 journals. */
  providerSignals?: Array<{ taskId: string; attemptId: string; providerId: string; providerMessageId: string; contentRef: string; kind: "question" | "escalation" }>;
}
