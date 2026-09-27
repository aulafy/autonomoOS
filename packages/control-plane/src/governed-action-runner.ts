import type { BudgetLedgerStore } from "@agent-world/budgets";
import type { FactCompiler } from "@agent-world/composition-policy";
import type { ContractStore } from "@agent-world/contracts";
import type { EffectCoordinator, EffectStore, EffectTransaction } from "@agent-world/effects";
import type { ObservationService, ObserverRegistry } from "@agent-world/observation";
import { ActionIntentSchema } from "@agent-world/protocol";
import type { ReconciliationService } from "@agent-world/reconciliation";
import { ResourceResolver, type ResourceRegistry } from "@agent-world/resources";
import type { LiveCommitGate } from "./commit-gate.js";
import { ControlPlaneError, type ControlEventSink, type ExecutorRegistry,
  type GovernedActionRegistry, type GovernedActionRequest, type GovernedResult,
  type PreparedAction } from "./types.js";

export interface RunnerIds { next(kind: "effect" | "execution" | "reservation" | "reconciliation"): string; }

export interface RunnerDependencies {
  actions: GovernedActionRegistry;
  executors: ExecutorRegistry;
  observers: ObserverRegistry;
  contracts: ContractStore;
  resources: ResourceRegistry;
  budgets: BudgetLedgerStore;
  effects: EffectStore;
  coordinator: EffectCoordinator;
  observationService: ObservationService;
  reconciliation: ReconciliationService;
  facts: FactCompiler;
  gate: LiveCommitGate;
  events: ControlEventSink;
  ids: RunnerIds;
  now(): number;
  observationMaxAgeMs: number;
  transaction?<T>(work: () => T): T;
}

export class GovernedActionRunner {
  private readonly pending = new Map<string, PreparedAction>();
  constructor(private readonly deps: RunnerDependencies) {}

  async admit(request: GovernedActionRequest): Promise<PreparedAction> {
    try {
      return await this.admitInternal(request);
    } catch (error) {
      this.deps.events.append({ type: "action.admission_denied",
        taskId: request.taskId, intentId: request.intent?.id ?? "",
        at: this.deps.now(), detail: { reasonCode: error instanceof ControlPlaneError
          ? error.code : error instanceof Error ? error.message : "ADMISSION_ERROR" } });
      throw error;
    }
  }

  private async admitInternal(request: GovernedActionRequest): Promise<PreparedAction> {
    const parsed = ActionIntentSchema.safeParse(request.intent);
    if (!parsed.success || !request.taskId || !request.principalId || !request.contractId ||
      !request.correlationId) throw new ControlPlaneError("INVALID_ACTION_INTENT");
    const definition = this.deps.actions.get(request.intent.action);
    if (!definition) throw new ControlPlaneError("ACTION_NOT_REGISTERED");
    const executor = this.deps.executors.get(definition.executorId);
    if (!executor) throw new ControlPlaneError("EXECUTOR_NOT_FOUND");
    if (!this.deps.observers.get(definition.observerId)) {
      throw new ControlPlaneError("OBSERVER_NOT_FOUND");
    }
    const resolved = new ResourceResolver(this.deps.resources).resolve(request.intent.targetId ?? "",
      { expectedKinds: definition.resourceKinds });
    if (!resolved.ok) throw new ControlPlaneError(`RESOURCE_${resolved.reason}`);
    const resource = resolved.resource;
    const sink = definition.requiresFlow && request.flowSinkId
      ? this.deps.resources.get(request.flowSinkId) : null;
    const contract = await this.deps.contracts.get(request.contractId);
    if (!contract?.budgetId) throw new ControlPlaneError("BUDGET_REQUIRED");
    const prerequisites = await this.deps.gate.checkPrerequisites(request, definition,
      resource.id, resource.generation, sink?.generation);
    const budget = this.deps.budgets.getBudget(contract.budgetId);
    if (!budget || budget.status !== "active" || budget.taskId !== request.taskId ||
      budget.ownerPrincipalId !== request.principalId ||
      (budget.expiresAt !== undefined && this.deps.now() >= budget.expiresAt)) {
      throw new ControlPlaneError("BUDGET_NOT_ACTIVE");
    }
    const effectId = this.deps.ids.next("effect");
    const reservationId = this.deps.ids.next("reservation");
    const expectedPostcondition = definition.expectedPostcondition(resource.id, request.intent);
    const preparedState = (this.deps.transaction ?? ((work) => work()))(() => {
      const reservation = this.deps.budgets.reserve({ id: reservationId,
      budgetId: budget.id, principalId: request.principalId, taskId: request.taskId,
      effectId, amount: definition.budgetAmount,
      expiresAt: definition.reservationTtlMs === undefined ? undefined :
        this.deps.now() + definition.reservationTtlMs }, budget.version);
      try {
        const created = this.deps.coordinator.createEffect({ id: effectId,
        taskId: request.taskId, sessionContractId: request.contractId,
        intentId: request.intent.id, executionId: this.deps.ids.next("execution"),
        executorId: definition.executorId, action: request.intent.action,
        parameters: request.intent.parameters ?? {}, expectedPostcondition,
        resourceIds: [resource.id],
        resourceFences: request.fencingToken === undefined ? {} :
          { [resource.id]: String(request.fencingToken) },
        authorityLeaseIds: [request.authorityLeaseId],
        resourceLeaseIds: request.resourceLeaseId ? [request.resourceLeaseId] : [],
        budgetReservationIds: [reservation.id], metadata: { planId: request.planId ?? null,
          budgetActualAmount: structuredClone(definition.budgetAmount),
          riskClass: definition.risk, observationMaxAgeMs: this.deps.observationMaxAgeMs } });
        this.deps.coordinator.prepare(created.id, created.version);
      } catch (error) {
        if (!this.deps.transaction) this.deps.budgets.releaseReservation(reservation.id,
          { principalId: request.principalId, taskId: request.taskId }, reservation.version);
        throw error;
      }
      const effect = this.deps.effects.get(effectId)!;
      this.deps.events.append({ type: "effect.prepared", taskId: request.taskId,
        intentId: request.intent.id, effectId, at: this.deps.now() });
      return { reservation, effect };
    });
    const currentBudget = this.deps.budgets.getBudget(budget.id)!;
    const prepared: PreparedAction = { request: structuredClone(request),
      definition: { ...definition, resourceKinds: [...definition.resourceKinds],
        budgetAmount: { ...definition.budgetAmount } },
      canonicalResourceId: resource.id, resourceGeneration: resource.generation,
      sinkGeneration: sink?.generation,
      effectId, reservationId, compositionDecision: prerequisites.composition,
      flowDecision: prerequisites.flow, expectedPostcondition,
      admissionSnapshot: { admittedAt: this.deps.now(), contractVersion: contract.version,
        resourceGeneration: resource.generation, sinkGeneration: sink?.generation,
        budgetVersion: currentBudget.version, reservationVersion: preparedState.reservation.version,
        effectVersion: preparedState.effect.version,
        compositionHistoryVersion: prerequisites.composition.historyVersion,
        flowWorkingSetVersion: prerequisites.flow?.workingSetVersion,
        authorityLeaseId: request.authorityLeaseId,
        resourceLeaseId: request.resourceLeaseId, fencingToken: request.fencingToken } };
    this.pending.set(effectId, prepared);
    return { ...prepared, request: structuredClone(prepared.request),
      definition: { ...prepared.definition, resourceKinds: [...prepared.definition.resourceKinds],
        budgetAmount: { ...prepared.definition.budgetAmount } },
      expectedPostcondition: structuredClone(prepared.expectedPostcondition),
      admissionSnapshot: structuredClone(prepared.admissionSnapshot) };
  }

  async dispatchPrepared(candidate: PreparedAction,
    signal: AbortSignal = new AbortController().signal): Promise<GovernedResult> {
    const prepared = this.pending.get(candidate.effectId);
    if (!prepared) throw new ControlPlaneError("PREPARED_ACTION_NOT_ISSUED");
    this.pending.delete(candidate.effectId);
    let current: EffectTransaction;
    try {
      await this.deps.gate.check(prepared);
    } catch (error) {
      this.deps.events.append({ type: "action.commit_denied",
        taskId: prepared.request.taskId, intentId: prepared.request.intent.id,
        effectId: prepared.effectId, at: this.deps.now(),
        detail: { reasonCode: error instanceof ControlPlaneError
          ? error.code : "COMMIT_GATE_DENIED" } });
      const effect = this.deps.effects.get(prepared.effectId);
      if (effect?.status === "prepared") {
        this.deps.coordinator.failBeforeDispatch(effect.id, effect.version,
          error instanceof Error ? error.message : "COMMIT_GATE_DENIED");
        this.releaseReservation(prepared);
      }
      return this.result(prepared, "blocked", error instanceof ControlPlaneError
        ? error.code : "COMMIT_GATE_DENIED");
    }
    const effect = this.deps.effects.get(prepared.effectId)!;
    current = (this.deps.transaction ?? ((work) => work()))(() => {
      const dispatching = this.deps.coordinator.startDispatch(effect.id, effect.version);
      this.deps.facts.fromEffectFacts(dispatching.id);
      this.emit("effect.dispatching", prepared);
      return dispatching;
    });
    const executor = this.deps.executors.get(prepared.definition.executorId)!;
    let report;
    try {
      report = await executor.dispatch({ taskId: prepared.request.taskId,
        intentId: prepared.request.intent.id, effectId: current.id,
        idempotencyKey: current.idempotencyKey,
        resourceIds: [prepared.canonicalResourceId],
        parameters: structuredClone(prepared.request.intent.parameters ?? {}) }, signal);
    } catch {
      current = this.deps.coordinator.recordExecutorError(current.id, current.version);
    }
    if (report) {
      current = this.deps.coordinator.recordDispatchResult(current.id, current.version, report);
      this.emit("effect.dispatch_reported", prepared);
    }
    if (current.status === "dispatching") {
      try {
        const observed = await this.deps.observationService.observe({
          observerId: prepared.definition.observerId,
          request: { subject: { taskId: prepared.request.taskId,
            intentId: prepared.request.intent.id, executionId: current.executionId,
            effectId: current.id, resourceIds: [prepared.canonicalResourceId] },
            expectedPostcondition: prepared.expectedPostcondition,
            context: { resourceIds: [prepared.canonicalResourceId],
              externalReference: current.externalReference } },
          riskClass: prepared.definition.risk,
          maxAgeMs: this.deps.observationMaxAgeMs
        }, signal);
        current = this.deps.coordinator.settleFromObservation(current.id, current.version,
          observed.observation.id, { riskClass: prepared.definition.risk,
            maxAgeMs: this.deps.observationMaxAgeMs });
      } catch {
        current = this.deps.coordinator.recordObservationError(current.id, current.version);
      }
    }
    this.deps.facts.fromEffectFacts(current.id);
    if (current.status === "committed") {
      this.commitReservation(prepared);
      this.emit("effect.committed", prepared);
      return this.result(prepared, "completed", "OBSERVATION_CONFIRMED", current.observationIds);
    }
    if (current.status === "failed") {
      if (current.failureCertainty === "certified_not_started") this.releaseReservation(prepared);
      this.emit("effect.failed", prepared);
      return this.result(prepared, "failed", "EFFECT_FAILED", current.observationIds);
    }
    if (current.status === "unknown") {
      this.deps.reconciliation.enqueue(this.deps.ids.next("reconciliation"), current.id, 3);
      this.emit("effect.unknown", prepared);
      return this.result(prepared, "unknown", "EFFECT_UNKNOWN", current.observationIds);
    }
    throw new ControlPlaneError("UNSETTLED_EFFECT");
  }

  private commitReservation(prepared: PreparedAction): void {
    const reservation = this.deps.budgets.getReservation(prepared.reservationId)!;
    this.deps.budgets.commitReservation(reservation.id,
      { principalId: prepared.request.principalId, taskId: prepared.request.taskId },
      prepared.definition.budgetAmount, reservation.version);
  }
  private releaseReservation(prepared: PreparedAction): void {
    const reservation = this.deps.budgets.getReservation(prepared.reservationId);
    if (reservation?.status === "active") this.deps.budgets.releaseReservation(reservation.id,
      { principalId: prepared.request.principalId, taskId: prepared.request.taskId },
      reservation.version);
  }
  private result(prepared: PreparedAction, status: GovernedResult["status"],
    reasonCode: string, observationIds: string[] = []): GovernedResult {
    return { status, taskId: prepared.request.taskId, intentId: prepared.request.intent.id,
      effectId: prepared.effectId, observationIds, reasonCode };
  }
  private emit(type: string, prepared: PreparedAction): void {
    this.deps.events.append({ type, taskId: prepared.request.taskId,
      intentId: prepared.request.intent.id, effectId: prepared.effectId,
      at: this.deps.now() });
  }
}
