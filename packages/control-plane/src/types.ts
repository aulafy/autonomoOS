import type { BudgetVector } from "@agent-world/budgets";
import type { CompositionDecision } from "@agent-world/composition-policy";
import type { ContractRisk } from "@agent-world/contracts";
import type { DispatchResult } from "@agent-world/effects";
import type { FlowDecision } from "@agent-world/information-flow";
import type { ExpectedPostcondition } from "@agent-world/observation";
import type { ActionIntent } from "@agent-world/protocol";
import type { ResourceId, ResourceKind } from "@agent-world/resources";

export interface GovernedActionDefinition {
  action: ActionIntent["action"];
  executorId: string;
  observerId: string;
  risk: ContractRisk;
  resourceKinds: ResourceKind[];
  requiresResourceLease: boolean;
  requiresFlow: boolean;
  budgetAmount: BudgetVector;
  reservationTtlMs?: number;
  expectedPostcondition(resourceId: ResourceId, intent: ActionIntent): ExpectedPostcondition;
}

export class GovernedActionRegistry {
  private readonly actions = new Map<string, GovernedActionDefinition>();
  register(definition: GovernedActionDefinition): void {
    if (!definition?.action || !definition.executorId || !definition.observerId ||
      this.actions.has(definition.action)) throw new ControlPlaneError("INVALID_ACTION_DEFINITION");
    this.actions.set(definition.action, definition);
  }
  get(action: string): GovernedActionDefinition | null {
    return this.actions.get(action) ?? null;
  }
}

export interface ExecutorContext {
  taskId: string;
  intentId: string;
  effectId: string;
  idempotencyKey: string;
  resourceIds: ResourceId[];
  parameters: Record<string, unknown>;
}
export interface SideEffectExecutor {
  readonly id: string;
  dispatch(context: ExecutorContext, signal: AbortSignal): Promise<DispatchResult>;
}
export class ExecutorRegistry {
  private readonly executors = new Map<string, SideEffectExecutor>();
  register(executor: SideEffectExecutor): void {
    if (!executor.id || this.executors.has(executor.id)) {
      throw new ControlPlaneError("INVALID_EXECUTOR");
    }
    this.executors.set(executor.id, executor);
  }
  get(id: string): SideEffectExecutor | null { return this.executors.get(id) ?? null; }
}

export interface GovernedActionRequest {
  taskId: string;
  principalId: string;
  contractId: string;
  intent: ActionIntent;
  authorityLeaseId: string;
  resourceLeaseId?: string;
  fencingToken?: number;
  flowObjectIds?: string[];
  flowSinkId?: ResourceId;
  compositionApprovalId?: string;
  releaseApprovalId?: string;
  planId?: string;
  correlationId: string;
}

export interface PreparedAction {
  request: GovernedActionRequest;
  definition: GovernedActionDefinition;
  canonicalResourceId: ResourceId;
  resourceGeneration: number;
  sinkGeneration?: number;
  effectId: string;
  reservationId: string;
  compositionDecision: CompositionDecision;
  flowDecision?: FlowDecision;
  expectedPostcondition: ExpectedPostcondition;
  admissionSnapshot: AdmissionSnapshot;
}

export interface AdmissionSnapshot {
  admittedAt: number;
  contractVersion: number;
  resourceGeneration: number;
  sinkGeneration?: number;
  budgetVersion: number;
  reservationVersion: number;
  effectVersion: number;
  compositionHistoryVersion: number;
  flowWorkingSetVersion?: number;
  authorityLeaseId: string;
  resourceLeaseId?: string;
  fencingToken?: number;
}

export type GovernedStatus = "completed" | "denied" | "approval_required" |
  "release_approval_required" | "blocked" | "failed" | "unknown";
export interface GovernedResult {
  status: GovernedStatus;
  taskId: string;
  intentId: string;
  effectId?: string;
  observationIds: string[];
  reasonCode: string;
}
export interface ControlEvent { type: string; taskId: string; intentId: string;
  effectId?: string; at: number; detail?: Record<string, unknown>; }
export interface ControlEventSink { append(event: ControlEvent): void; }
export class InMemoryControlEventSink implements ControlEventSink {
  readonly events: ControlEvent[] = [];
  append(event: ControlEvent): void { this.events.push(structuredClone(event)); }
}
export class ControlPlaneError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ControlPlaneError"; }
}
