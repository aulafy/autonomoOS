import type { BudgetLedgerStore } from "@agent-world/budgets";
import type { CompositionEngine, CompositionDecision } from "@agent-world/composition-policy";
import type { ContractStore, ContractValidator } from "@agent-world/contracts";
import type { EffectStore } from "@agent-world/effects";
import type { FlowEngine, FlowDecision } from "@agent-world/information-flow";
import type { LeaseCommitGate, ResourceLeaseStore } from "@agent-world/leases";
import { authorize } from "@agent-world/policy-engine";
import type { ResourceId, ResourceRegistry } from "@agent-world/resources";
import type { RuntimeSnapshot, SupervisorEngine } from "@agent-world/supervision";
import { ControlPlaneError, type GovernedActionDefinition,
  type GovernedActionRequest, type PreparedAction } from "./types.js";

export interface TaskStatusPort { isRunnable(taskId: string): boolean; }
export interface CommitGateDependencies {
  contracts: ContractStore;
  contractValidator: ContractValidator;
  resources: ResourceRegistry;
  leases: LeaseCommitGate;
  resourceLeases: ResourceLeaseStore;
  budgets: BudgetLedgerStore;
  effects: EffectStore;
  composition: CompositionEngine;
  flow: FlowEngine;
  supervisor: SupervisorEngine;
  snapshot(): RuntimeSnapshot;
  tasks: TaskStatusPort;
  runtimeMode?: { allowsConsequentialDispatch(): boolean };
  now(): number;
}

export interface PrerequisiteResult { composition: CompositionDecision; flow?: FlowDecision; }

export class LiveCommitGate {
  constructor(private readonly deps: CommitGateDependencies) {}

  async checkPrerequisites(request: GovernedActionRequest,
    definition: GovernedActionDefinition, resourceId: ResourceId,
    expectedGeneration: number, expectedSinkGeneration?: number): Promise<PrerequisiteResult> {
    if (!this.deps.tasks.isRunnable(request.taskId)) throw new ControlPlaneError("TASK_NOT_RUNNABLE");
    if (this.deps.runtimeMode && !this.deps.runtimeMode.allowsConsequentialDispatch()) {
      throw new ControlPlaneError("RUNTIME_READ_ONLY");
    }
    const contract = await this.deps.contracts.get(request.contractId);
    if (!contract || contract.taskId !== request.taskId ||
      contract.ownerPrincipalId !== request.principalId) {
      throw new ControlPlaneError("CONTRACT_NOT_ACTIVE");
    }
    const resource = this.deps.resources.get(resourceId);
    if (!resource || resource.generation !== expectedGeneration) {
      throw new ControlPlaneError("RESOURCE_GENERATION_CHANGED");
    }
    const canonicalIntent = { ...request.intent, targetId: resourceId };
    if (!this.deps.contractValidator.validateIntent(contract, canonicalIntent,
      definition.risk, this.deps.now()).allowed) throw new ControlPlaneError("CONTRACT_DENIED");
    const lease = this.deps.leases.check({ leaseId: request.authorityLeaseId,
      subjectPrincipalId: request.principalId, taskId: request.taskId,
      action: request.intent.action, resourceId,
      requireResourceLease: definition.requiresResourceLease,
      fencingToken: request.fencingToken });
    if (!lease.allowed) throw new ControlPlaneError(lease.reason ?? "LEASE_DENIED");
    if (definition.requiresFlow) {
      const sink = request.flowSinkId ? this.deps.resources.get(request.flowSinkId) : null;
      if (!sink || sink.generation !== expectedSinkGeneration) {
        throw new ControlPlaneError("FLOW_SINK_GENERATION_CHANGED");
      }
      if (contract.allowedResourceIds.length > 0 &&
        !contract.allowedResourceIds.includes(sink.id)) {
        throw new ControlPlaneError("FLOW_SINK_OUT_OF_CONTRACT_SCOPE");
      }
      const sinkLease = this.deps.leases.check({ leaseId: request.authorityLeaseId,
        subjectPrincipalId: request.principalId, taskId: request.taskId,
        action: request.intent.action, resourceId: sink.id });
      if (!sinkLease.allowed) throw new ControlPlaneError(sinkLease.reason);
    }
    if (definition.requiresResourceLease) {
      const held = request.resourceLeaseId
        ? this.deps.resourceLeases.get(request.resourceLeaseId) : null;
      if (!held || held.resourceId !== resourceId || held.taskId !== request.taskId ||
        held.holderPrincipalId !== request.principalId || held.status !== "active" ||
        held.fencingToken !== request.fencingToken || this.deps.now() >= held.expiresAt) {
        throw new ControlPlaneError("RESOURCE_LEASE_REQUIRED");
      }
    }
    if (!authorize(canonicalIntent).allowed) throw new ControlPlaneError("POLICY_DENIED");
    const composition = this.deps.composition.evaluate({ taskId: request.taskId,
      intentId: request.intent.id, planId: request.planId,
      actionType: request.intent.action, resourceIds: request.flowSinkId &&
        request.flowSinkId !== resourceId ? [resourceId, request.flowSinkId] : [resourceId],
      sinkId: request.flowSinkId }, request.compositionApprovalId);
    if (composition.verdict === "deny") throw new ControlPlaneError("COMPOSITION_DENIED");
    if (composition.verdict === "require_approval") {
      throw new ControlPlaneError("COMPOSITION_APPROVAL_REQUIRED");
    }
    let flow: FlowDecision | undefined;
    if (definition.requiresFlow) {
      if (!request.flowSinkId) throw new ControlPlaneError("FLOW_SINK_REQUIRED");
      flow = this.deps.flow.evaluate({ taskId: request.taskId, intentId: request.intent.id,
        objectIds: request.flowObjectIds ?? [], sinkId: request.flowSinkId },
      request.releaseApprovalId);
      if (flow.verdict === "deny") throw new ControlPlaneError("FLOW_DENIED");
      if (flow.verdict === "require_release_approval") {
        throw new ControlPlaneError("RELEASE_APPROVAL_REQUIRED");
      }
    }
    if (!this.deps.supervisor.mayStart(this.deps.snapshot(), "consequential",
      definition.executorId)) throw new ControlPlaneError("SUPERVISOR_STOP");
    return { composition, flow };
  }

  async check(prepared: PreparedAction): Promise<PrerequisiteResult> {
    const current = await this.checkPrerequisites(prepared.request, prepared.definition,
      prepared.canonicalResourceId, prepared.resourceGeneration, prepared.sinkGeneration);
    const effect = this.deps.effects.get(prepared.effectId);
    if (!effect || effect.status !== "prepared") throw new ControlPlaneError("EFFECT_NOT_PREPARED");
    const reservation = this.deps.budgets.getReservation(prepared.reservationId);
    const budget = reservation ? this.deps.budgets.getBudget(reservation.budgetId) : null;
    if (!reservation || reservation.status !== "active" || !budget ||
      budget.status !== "active" ||
      reservation.taskId !== prepared.request.taskId ||
      reservation.effectId !== prepared.effectId ||
      (reservation.expiresAt !== undefined && this.deps.now() >= reservation.expiresAt) ||
      (budget.expiresAt !== undefined && this.deps.now() >= budget.expiresAt)) {
      throw new ControlPlaneError("BUDGET_RESERVATION_NOT_ACTIVE");
    }
    return current;
  }
}
