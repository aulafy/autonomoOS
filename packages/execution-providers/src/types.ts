import type { Constraint, JsonValue, ProviderExecutionRef } from "@agent-world/task-runtime";
export type { ProviderExecutionRef } from "@agent-world/task-runtime";
export type ProviderAvailability =
  | { status: "available"; version?: string; capabilities: string[] }
  | { status: "degraded"; reason: string; capabilities: string[] }
  | { status: "unavailable"; reason: string };
export interface ActorCapability { capability: string; confidence: number; constraints?: Constraint[] }
export interface ActorDescriptor {
  id: string; providerId: string;
  kind: "llm" | "coding-agent" | "browser-agent" | "computer-agent" | "api" | "deterministic" | "human";
  capabilities: ActorCapability[];
  costProfile: { currency: string; estimatedCost: number | null };
  latencyProfile: { estimatedMs: number | null };
  trustProfile: { level: "untrusted" | "restricted" | "trusted" };
  privacyProfile: { locality: "local" | "remote"; dataResidency: string[] };
  availability: "available" | "degraded" | "unavailable";
}
export interface PrepareExecutionInput {
  taskId: string; workUnitId: string; attemptId: string; actorId: string;
  objective: string; contextRef: string; authorizationRef: string;
  resourceRefs: string[]; dispatchFingerprint: string;
}
export type PreparedExecution =
  | { status: "prepared"; providerId: string; attemptId: string; handle: string; dispatchFingerprint: string }
  | { status: "rejected" | "unknown"; reason: string };
export interface DispatchExecutionInput {
  taskId: string; workUnitId: string; attemptId: string; actorId: string;
  handle: string; dispatchFingerprint: string; authorizationRef: string;
}
export type DispatchReceipt =
  | { status: "dispatched"; ref: ProviderExecutionRef; observedAt: number }
  | { status: "not-executed"; reason: string }
  | { status: "unknown" | "timeout"; reason: string; ref?: ProviderExecutionRef };
export type ProviderObservation =
  | { status: "running" | "reported-success" | "reported-failure"; observedAt: number; details?: JsonValue }
  | { status: "exited"; observedAt: number; exitCode?: number; details?: JsonValue }
  | { status: "unknown" | "unverifiable" | "timeout" | "not-found"; observedAt: number; reason: string };
export interface ProviderMessage { id: string; inReplyTo?: string; text: string }
export interface ProviderSignal {
  id: string; attemptId: string; observedAt: number;
  type: "reported-success" | "reported-failure" | "question" | "escalation";
  text: string; options?: string[];
}
export type ProviderSignalsResult = { status: "observed"; signals: ProviderSignal[] }
  | { status: "unverifiable" | "timeout"; reason: string };
export type ProviderMutationReceipt = { status: "accepted"; operationId: string } | { status: "rejected" | "unknown" | "timeout"; reason: string };
export type SendReceipt = ProviderMutationReceipt;
export type ProviderReconciliationResult =
  | { status: "observed"; observation: ProviderObservation }
  | { status: "not-executed"; evidenceRefs: string[] }
  | { status: "unknown" | "unverifiable" | "timeout"; reason: string };
export interface ExecutionProvider {
  readonly id: string;
  probe(): Promise<ProviderAvailability>;
  listActors(): Promise<ActorDescriptor[]>;
  prepare(input: PrepareExecutionInput): Promise<PreparedExecution>;
  dispatch(input: DispatchExecutionInput): Promise<DispatchReceipt>;
  observe(ref: ProviderExecutionRef): Promise<ProviderObservation>;
  receive?(ref: ProviderExecutionRef): Promise<ProviderSignalsResult>;
  send?(ref: ProviderExecutionRef, message: ProviderMessage): Promise<SendReceipt>;
  cancel?(ref: ProviderExecutionRef, reason: string): Promise<ProviderMutationReceipt>;
  reconcile?(ref: ProviderExecutionRef, previous: ProviderObservation): Promise<ProviderReconciliationResult>;
}
