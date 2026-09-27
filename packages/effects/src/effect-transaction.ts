import type { ResourceId } from "@agent-world/resources";
import type { ExpectedPostcondition, ObservationEvaluation } from "@agent-world/observation";
import type { DispatchResult, FailureCertainty } from "./dispatch-result.js";
import type { EffectStatus } from "./effect-status.js";

export interface EffectTransaction {
  id: string;
  taskId: string;
  sessionContractId?: string;
  intentId: string;
  executionId: string;
  executorId: string;
  action: string;
  parameters: unknown;
  expectedPostcondition: ExpectedPostcondition;
  expectedPostconditionHash: string;
  status: EffectStatus;
  idempotencyKey: string;
  resourceIds: ResourceId[];
  resourceFences: Record<string, string>;
  capabilityGrantIds: string[];
  authorityLeaseIds: string[];
  resourceLeaseIds: string[];
  budgetReservationIds: string[];
  policyDecisionId?: string;
  compositionDecisionId?: string;
  flowDecisionId?: string;
  observationIds: string[];
  externalReference?: string;
  dispatchResult?: DispatchResult;
  settlementEvaluation?: ObservationEvaluation;
  reconciliationDecisionId?: string;
  unknownReasonCode?: string;
  createdAt: number;
  preparedAt?: number;
  dispatchStartedAt?: number;
  settledAt?: number;
  failureCertainty?: FailureCertainty;
  version: number;
  metadata: Record<string, unknown>;
}

export interface CreateEffectInput {
  id: string;
  taskId: string;
  sessionContractId?: string;
  intentId: string;
  executionId: string;
  executorId: string;
  action: string;
  parameters: unknown;
  expectedPostcondition: ExpectedPostcondition;
  resourceIds: ResourceId[];
  resourceFences?: Record<string, string>;
  capabilityGrantIds?: string[];
  authorityLeaseIds?: string[];
  resourceLeaseIds?: string[];
  budgetReservationIds?: string[];
  policyDecisionId?: string;
  compositionDecisionId?: string;
  flowDecisionId?: string;
  metadata?: Record<string, unknown>;
}
