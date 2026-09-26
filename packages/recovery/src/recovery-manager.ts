import type { BudgetLedgerStore, BudgetVector } from "@agent-world/budgets";
import type { EffectCoordinator, EffectStore, EffectTransaction } from "@agent-world/effects";
import type { ObservationPolicy, ObservationStore, ObserverRegistry } from "@agent-world/observation";
import type { InMemoryReconciliationQueue, ReconciliationService } from "@agent-world/reconciliation";
import type { InMemoryEmergencyStopStore, InMemoryQuarantineStore } from "@agent-world/supervision";
import { RecoveryPlanner } from "./recovery-planner.js";
import { RuntimeModeController, type RecoveryAction, type RecoveryEventSink,
  type RecoveryPlan } from "./types.js";

export interface RecoveryDependencies {
  effects: EffectStore;
  coordinator: EffectCoordinator;
  observations: ObservationStore;
  observers: ObserverRegistry;
  observationPolicy: ObservationPolicy;
  budgets: BudgetLedgerStore;
  queue: InMemoryReconciliationQueue;
  reconciliation: ReconciliationService;
  emergencyStop: InMemoryEmergencyStopStore;
  quarantines: InMemoryQuarantineStore;
  mode: RuntimeModeController;
  events: RecoveryEventSink;
  now(): number;
  criticalStoresHealthy(): boolean;
  policyHealthy(): boolean;
  resourcesHealthy(): boolean;
  authorityReadable(): boolean;
  startupSupervisorHealthy?(): boolean;
}

/** Applies only local bookkeeping and read-only reconciliation scheduling. */
export class RecoveryManager {
  constructor(private readonly deps: RecoveryDependencies) {}

  run(requestedPlan?: RecoveryPlan): { mode: string; failedActions: string[] } {
    if (this.deps.mode.mode !== "recovering") {
      throw new Error("RECOVERY_MODE_REQUIRED");
    }
    const planId = requestedPlan?.id ?? `startup:${this.deps.now()}`;
    this.emit("recovery.started", planId);
    if (!this.deps.criticalStoresHealthy()) {
      this.deps.mode.enterReadOnly();
      this.emit("recovery.completed", planId);
      return { mode: this.deps.mode.mode, failedActions: ["CRITICAL_STORE_UNHEALTHY"] };
    }
    let plan: RecoveryPlan;
    try {
      plan = new RecoveryPlanner(this.deps.effects, this.deps.now, this.deps.budgets)
        .plan(planId);
      if (requestedPlan && JSON.stringify(requestedPlan.actions) !== JSON.stringify(plan.actions)) {
        throw new Error("STALE_OR_INCOMPLETE_RECOVERY_PLAN");
      }
    } catch (error) {
      this.deps.mode.enterReadOnly();
      this.emit("recovery.action_failed", planId, undefined,
        error instanceof Error ? error.message : "RECOVERY_PLAN_INVALID");
      this.emit("recovery.completed", planId);
      return { mode: this.deps.mode.mode, failedActions: ["RECOVERY_PLAN_INVALID"] };
    }
    const failedActions: string[] = [];
    for (const action of plan.actions) {
      try {
        this.apply(action);
        this.emit("recovery.action_applied", plan.id, action.id);
      } catch (error) {
        failedActions.push(action.id);
        this.emit("recovery.action_failed", plan.id, action.id,
          error instanceof Error ? error.message : "RECOVERY_ACTION_FAILED");
      }
    }
    const healthy = failedActions.length === 0 && this.deps.criticalStoresHealthy() &&
      this.deps.policyHealthy() && this.deps.resourcesHealthy() &&
      this.deps.authorityReadable() && !this.deps.emergencyStop.get().active &&
      (this.deps.startupSupervisorHealthy?.() ?? true);
    if (healthy) this.deps.mode.enterNormal();
    else this.deps.mode.enterReadOnly();
    this.emit("recovery.completed", plan.id);
    return { mode: this.deps.mode.mode, failedActions };
  }

  private apply(action: RecoveryAction): void {
    if (action.kind === "cleanup_orphan_reservation") {
      const reservation = action.reservationId
        ? this.deps.budgets.getReservation(action.reservationId) : null;
      if (reservation?.status === "active") {
        if (reservation.effectId !== action.effectId ||
          this.deps.effects.get(action.effectId)) return;
        this.deps.budgets.releaseReservation(reservation.id,
          { principalId: reservation.principalId, taskId: reservation.taskId },
          reservation.version);
      }
      return;
    }
    const effect = this.deps.effects.get(action.effectId);
    if (!effect) throw new Error("EFFECT_NOT_FOUND");
    switch (action.kind) {
      case "cleanup_pre_dispatch":
        if (effect.status === "preparing" || effect.status === "prepared") {
          this.deps.coordinator.failBeforeDispatch(effect.id, effect.version,
            "RECOVERY_PRE_DISPATCH_CLEANUP");
        }
        this.releaseCertified(effect);
        return;
      case "mark_dispatching_unknown":
        if (effect.status === "dispatching") {
          if (!this.settleDurableObservation(effect)) {
            this.deps.coordinator.markDispatchingUnknownAfterCrash(effect.id, effect.version);
          } else {
            this.repairCommitted(this.deps.effects.get(effect.id)!);
          }
        }
        return;
      case "ensure_reconciliation": {
        const current = this.deps.effects.get(effect.id)!;
        if (current.status !== "unknown") return;
        if (!this.deps.queue.findByEffect(effect.id)) {
          this.deps.reconciliation.enqueue(`recovery:${effect.id}`, effect.id, 3);
        }
        return;
      }
      case "repair_committed_budget":
        if (effect.status === "committed") this.repairCommitted(effect);
        return;
      case "cleanup_failed_budget":
        if (effect.status === "failed") this.releaseCertified(effect);
        return;
    }
  }

  private settleDurableObservation(effect: EffectTransaction): boolean {
    const riskClass = effect.metadata.riskClass;
    const maxAgeMs = effect.metadata.observationMaxAgeMs;
    if (!["R0", "R1", "R2", "R3", "R4", "R5"].includes(String(riskClass)) ||
      typeof maxAgeMs !== "number" || !Number.isFinite(maxAgeMs) || maxAgeMs < 0) return false;
    const entries = this.deps.observations.listByEffect(effect.id).flatMap(observation => {
      const observer = this.deps.observers.get(observation.observerId);
      return observer ? [{ observation, descriptor: observer.descriptor }] : [];
    });
    const requirement = { subject: { taskId: effect.taskId, intentId: effect.intentId,
      executionId: effect.executionId, effectId: effect.id, resourceIds: effect.resourceIds },
      expectedPostcondition: effect.expectedPostcondition,
      riskClass: riskClass as "R0" | "R1" | "R2" | "R3" | "R4" | "R5", maxAgeMs };
    const overall = this.deps.observationPolicy.evaluateObservations(entries, requirement);
    if (!overall.accepted || overall.effectiveStatus !== "confirmed") return false;
    const accepted = entries.find(entry => {
      const decision = this.deps.observationPolicy.evaluate(entry.observation,
        entry.descriptor, requirement);
      return decision.accepted && decision.effectiveStatus === "confirmed";
    });
    if (!accepted) return false;
    this.deps.coordinator.settleFromObservation(effect.id, effect.version,
      accepted.observation.id, { riskClass: requirement.riskClass, maxAgeMs });
    return true;
  }

  private releaseCertified(effect: EffectTransaction): void {
    const current = this.deps.effects.get(effect.id)!;
    if (current.status !== "failed" ||
      current.failureCertainty !== "certified_not_started") return;
    for (const id of current.budgetReservationIds) {
      const reservation = this.deps.budgets.getReservation(id);
      if (reservation?.status === "active") {
        this.deps.budgets.releaseReservation(id, { principalId: reservation.principalId,
          taskId: reservation.taskId }, reservation.version);
      }
    }
  }

  private repairCommitted(effect: EffectTransaction): void {
    for (const id of effect.budgetReservationIds) {
      const reservation = this.deps.budgets.getReservation(id);
      if (!reservation) throw new Error("RESERVATION_NOT_FOUND");
      if (reservation.status === "committed") continue;
      if (reservation.status !== "active" || reservation.effectId !== effect.id) {
        throw new Error("RESERVATION_CANNOT_REPAIR");
      }
      const actual = effect.metadata.budgetActualAmount;
      if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
        throw new Error("ACTUAL_BUDGET_UNKNOWN");
      }
      this.deps.budgets.commitReservation(id, { principalId: reservation.principalId,
        taskId: reservation.taskId }, actual as BudgetVector, reservation.version);
    }
  }

  private emit(type: Parameters<RecoveryEventSink["append"]>[0]["type"],
    planId: string, actionId?: string, reason?: string): void {
    this.deps.events.append({ type, planId, actionId, reason, at: this.deps.now() });
  }
}
