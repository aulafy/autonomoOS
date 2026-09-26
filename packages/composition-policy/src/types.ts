import type { ResourceId } from "@agent-world/resources";

export type FactKind = "sensitive_read" | "secret_observed" | "credential_access" |
  "untrusted_code_executed" | "payment_attempted" | "external_send_attempted" |
  "external_send_committed";
export type FactSource = "committed_effect" | "effect_attempt" | "accepted_observation" |
  "trusted_control_event";

export interface HistoryFact {
  id: string;
  taskId: string;
  kind: FactKind;
  occurredAt: number;
  source: FactSource;
  sourceId: string;
  effectId?: string;
  resourceIds: ResourceId[];
  metadata: Record<string, unknown>;
}

export type ActionClass = "safe" | "sensitive_read" | "external_send" |
  "public_publish" | "credential_access" | "untrusted_code_execution" |
  "payment" | "robot_action";
export type SinkTrust = "local" | "trusted" | "external" | "public" | "unknown";

export interface ActionDescriptor {
  actionType: string;
  actionClass: ActionClass;
}

export interface CompositionCandidate {
  taskId: string;
  intentId: string;
  planId?: string;
  actionType: string;
  actionClass: ActionClass;
  resourceIds: ResourceId[];
  sinkId?: ResourceId;
  sinkTrust?: SinkTrust;
}

export interface CandidateRequest {
  taskId: string;
  intentId: string;
  planId?: string;
  actionType: string;
  resourceIds: ResourceId[];
  sinkId?: ResourceId;
}

export type CompositionVerdict = "allow" | "require_approval" | "deny";
export interface CompositionRuleResult {
  ruleId: string;
  verdict: CompositionVerdict;
  reason: string;
}

export interface CompositionDecision {
  taskId: string;
  intentId: string;
  actionType: string;
  resourceIds: ResourceId[];
  sinkId?: ResourceId;
  verdict: CompositionVerdict;
  historyVersion: number;
  evaluatedAt: number;
  ruleResults: CompositionRuleResult[];
  approvalId?: string;
}

export interface CompositionContext { now: number; }
export interface CompositionRule {
  readonly id: string;
  readonly version: string;
  evaluate(history: readonly HistoryFact[], candidate: CompositionCandidate,
    context: CompositionContext): CompositionRuleResult;
}

export interface Approval {
  id: string;
  taskId: string;
  intentId: string;
  actionType: string;
  resourceIds: ResourceId[];
  sinkId?: ResourceId;
  historyVersion: number;
  issuedAt: number;
  expiresAt: number;
  issuerId: string;
}

export class CompositionError extends Error {
  constructor(readonly code: string) { super(code); this.name = "CompositionError"; }
}
