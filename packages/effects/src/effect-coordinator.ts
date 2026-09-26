import type { ContractRisk } from "@agent-world/contracts";
import {
  postconditionHash, type Observation,
  type ObservationPolicy, type ObservationStore, type ObserverRegistry
} from "@agent-world/observation";
import type { Clock } from "./clock.js";
import type { DispatchResult } from "./dispatch-result.js";
import type { EffectEventSink, EffectEventType } from "./effect-events.js";
import type { EffectStatus } from "./effect-status.js";
import type { CreateEffectInput, EffectTransaction } from "./effect-transaction.js";
import type { EffectStore } from "./effect-store.js";
import { EffectError } from "./errors.js";
import { effectIdempotencyKey } from "./idempotency.js";

export interface ObservationSettlementOptions {
  riskClass: ContractRisk;
  maxAgeMs: number;
  requireGenerationBinding?: boolean;
}

// Control-plane state machine only. It never calls an executor or mutates budgets.
export class EffectCoordinator {
  constructor(
    private readonly effects: EffectStore,
    private readonly observations: ObservationStore,
    private readonly observers: ObserverRegistry,
    private readonly policy: ObservationPolicy,
    private readonly events: EffectEventSink,
    private readonly clock: Clock
  ) {}

  createEffect(input: CreateEffectInput): EffectTransaction {
    if (!input.id || !input.taskId || !input.intentId || !input.executionId ||
      !input.executorId || !input.action) throw new EffectError("INVALID_EFFECT_INPUT");
    let key: string;
    let expectedHash: string;
    let parameters: unknown;
    let expectedPostcondition: CreateEffectInput["expectedPostcondition"];
    let resourceFences: Record<string, string>;
    let metadata: Record<string, unknown>;
    try {
      key = effectIdempotencyKey(input);
      expectedHash = postconditionHash(input.expectedPostcondition);
      parameters = structuredClone(input.parameters);
      expectedPostcondition = structuredClone(input.expectedPostcondition);
      resourceFences = structuredClone(input.resourceFences ?? {});
      metadata = structuredClone(input.metadata ?? {});
    } catch {
      throw new EffectError("INVALID_EFFECT_INPUT");
    }
    const effect: EffectTransaction = {
      id: input.id, taskId: input.taskId, sessionContractId: input.sessionContractId,
      intentId: input.intentId, executionId: input.executionId, executorId: input.executorId,
      action: input.action, parameters,
      expectedPostcondition,
      expectedPostconditionHash: expectedHash, status: "preparing", idempotencyKey: key,
      resourceIds: [...input.resourceIds], resourceFences,
      capabilityGrantIds: [...(input.capabilityGrantIds ?? [])],
      authorityLeaseIds: [...(input.authorityLeaseIds ?? [])],
      resourceLeaseIds: [...(input.resourceLeaseIds ?? [])],
      budgetReservationIds: [...(input.budgetReservationIds ?? [])],
      policyDecisionId: input.policyDecisionId,
      compositionDecisionId: input.compositionDecisionId, flowDecisionId: input.flowDecisionId,
      observationIds: [], createdAt: this.clock.now(), version: 1,
      metadata
    };
    const created = this.effects.create(effect);
    this.emit("effect.created", created);
    return created;
  }

  prepare(id: string, expectedVersion: number): EffectTransaction {
    const current = this.requireEffect(id, expectedVersion);
    this.requireStatus(current, "preparing");
    const next = this.effects.update({ ...current, status: "prepared",
      preparedAt: this.clock.now(), version: current.version + 1 }, expectedVersion);
    this.emit("effect.prepared", next, current.status);
    return next;
  }

  failBeforeDispatch(id: string, expectedVersion: number, reason: string): EffectTransaction {
    const current = this.requireEffect(id, expectedVersion);
    if (current.status !== "preparing" && current.status !== "prepared") {
      throw new EffectError("INVALID_EFFECT_TRANSITION", `${current.status}->failed`);
    }
    const next = this.effects.update({ ...current, status: "failed",
      failureCertainty: "certified_not_started", settledAt: this.clock.now(),
      version: current.version + 1 }, expectedVersion);
    this.emit("effect.failed", next, current.status, { reason, certainty: "certified_not_started" });
    return next;
  }

  startDispatch(id: string, expectedVersion: number): EffectTransaction {
    const current = this.requireEffect(id, expectedVersion);
    this.requireStatus(current, "prepared");
    // The store update is completed before any caller can invoke an external executor.
    const next = this.effects.update({ ...current, status: "dispatching",
      dispatchStartedAt: this.clock.now(), version: current.version + 1 }, expectedVersion);
    this.emit("effect.dispatch_started", next, current.status);
    return next;
  }

  recordDispatchResult(id: string, expectedVersion: number, result: DispatchResult): EffectTransaction {
    const current = this.requireEffect(id, expectedVersion);
    this.requireStatus(current, "dispatching");
    if (current.dispatchResult) throw new EffectError("INVALID_EFFECT_TRANSITION", "duplicate_dispatch_report");
    this.validateDispatchResult(result);
    const now = this.clock.now();
    const status: EffectStatus = result.kind === "reported_success" ? "dispatching" :
      result.kind === "reported_failure" && result.certainty === "certified_not_started" ? "failed" : "unknown";
    const next = this.effects.update({ ...current, status,
      dispatchResult: structuredClone(result),
      externalReference: "externalReference" in result ? result.externalReference : undefined,
      failureCertainty: result.kind === "reported_failure" ? result.certainty : undefined,
      unknownReasonCode: status === "unknown" ? "DISPATCH_OUTCOME_UNKNOWN" : undefined,
      settledAt: status === "dispatching" ? undefined : now,
      version: current.version + 1 }, expectedVersion);
    this.emit("effect.dispatch_reported", next, current.status, { resultKind: result.kind });
    if (status === "failed") this.emit("effect.failed", next, current.status,
      { reason: "DISPATCH_REPORTED_FAILURE" });
    if (status === "unknown") this.emit("effect.unknown", next, current.status,
      { reason: "DISPATCH_OUTCOME_UNKNOWN" });
    return next;
  }

  recordExecutorError(id: string, expectedVersion: number): EffectTransaction {
    const current = this.requireEffect(id, expectedVersion);
    this.requireStatus(current, "dispatching");
    if (current.dispatchResult) throw new EffectError("INVALID_EFFECT_TRANSITION", "duplicate_dispatch_report");
    const next = this.effects.update({ ...current, status: "unknown",
      dispatchResult: { kind: "unknown", reason: "EXECUTOR_ERROR_AFTER_DISPATCH", metadata: {} },
      unknownReasonCode: "EXECUTOR_ERROR_AFTER_DISPATCH", settledAt: this.clock.now(),
      version: current.version + 1 }, expectedVersion);
    this.emit("effect.dispatch_reported", next, current.status, { resultKind: "executor_error" });
    this.emit("effect.unknown", next, current.status,
      { reason: "EXECUTOR_ERROR_AFTER_DISPATCH" });
    return next;
  }

  recordObservationError(id: string, expectedVersion: number): EffectTransaction {
    const current = this.requireEffect(id, expectedVersion);
    this.requireStatus(current, "dispatching");
    const next = this.effects.update({ ...current, status: "unknown",
      unknownReasonCode: "OBSERVATION_ERROR_AFTER_DISPATCH", settledAt: this.clock.now(),
      version: current.version + 1 }, expectedVersion);
    this.emit("effect.unknown", next, current.status,
      { reason: "OBSERVATION_ERROR_AFTER_DISPATCH" });
    return next;
  }

  /** Recovery-only transition. A persisted dispatch boundary may have reached the executor. */
  markDispatchingUnknownAfterCrash(id: string, expectedVersion: number): EffectTransaction {
    const current = this.requireEffect(id, expectedVersion);
    this.requireStatus(current, "dispatching");
    const next = this.effects.update({ ...current, status: "unknown",
      unknownReasonCode: "CRASH_DURING_DISPATCH", settledAt: this.clock.now(),
      version: current.version + 1 }, expectedVersion);
    this.emit("effect.unknown", next, current.status,
      { reason: "CRASH_DURING_DISPATCH" });
    return next;
  }

  settleFromObservation(id: string, expectedVersion: number, observationId: string,
    options: ObservationSettlementOptions): EffectTransaction {
    const current = this.requireEffect(id, expectedVersion);
    this.requireStatus(current, "dispatching");
    const observation = this.observations.get(observationId);
    if (!observation) throw new EffectError("OBSERVATION_NOT_FOUND", observationId);
    this.checkObservationBinding(current, observation);
    const observer = this.observers.get(observation.observerId);
    if (!observer) throw new EffectError("OBSERVER_NOT_FOUND", observation.observerId);
    const evaluation = this.policy.evaluate(observation, observer.descriptor, {
      subject: { taskId: current.taskId, intentId: current.intentId,
        executionId: current.executionId, effectId: observation.subject.effectId,
        resourceIds: current.resourceIds },
      expectedPostcondition: current.expectedPostcondition,
      riskClass: options.riskClass, maxAgeMs: options.maxAgeMs,
      requireGenerationBinding: options.requireGenerationBinding
    });
    const status: EffectStatus = evaluation.accepted && evaluation.effectiveStatus === "confirmed"
      ? "committed" : evaluation.accepted && evaluation.effectiveStatus === "contradicted"
        ? "failed" : "unknown";
    const next = this.effects.update({ ...current, status,
      observationIds: [...current.observationIds, observation.id],
      settlementEvaluation: evaluation,
      failureCertainty: status === "failed" ? "may_have_started" : current.failureCertainty,
      unknownReasonCode: status === "unknown" ? evaluation.reasonCode : undefined,
      settledAt: this.clock.now(), version: current.version + 1 }, expectedVersion);
    const eventType: EffectEventType = status === "committed" ? "effect.committed" :
      status === "failed" ? "effect.failed" : "effect.unknown";
    this.emit(eventType, next, current.status,
      { observationId: observation.id, evaluationReason: evaluation.reasonCode });
    return next;
  }

  private requireEffect(id: string, expectedVersion: number): EffectTransaction {
    const effect = this.effects.get(id);
    if (!effect) throw new EffectError("EFFECT_NOT_FOUND", id);
    if (effect.version !== expectedVersion) throw new EffectError("VERSION_CONFLICT");
    return effect;
  }
  private requireStatus(effect: EffectTransaction, expected: EffectStatus): void {
    if (effect.status !== expected) {
      throw new EffectError("INVALID_EFFECT_TRANSITION", `${effect.status}->${expected}`);
    }
  }
  private validateDispatchResult(result: DispatchResult): void {
    if (!result || !["reported_success", "reported_failure", "unknown"].includes(result.kind) ||
      !result.metadata || typeof result.metadata !== "object" ||
      (result.kind === "reported_failure" &&
        (!result.reason || !["certified_not_started", "may_have_started"].includes(result.certainty))) ||
      (result.kind === "unknown" && !result.reason)) {
      throw new EffectError("INVALID_EFFECT_INPUT", "invalid_dispatch_result");
    }
  }
  private checkObservationBinding(effect: EffectTransaction, observation: Observation): void {
    const subject = observation.subject;
    if (subject.effectId !== undefined && subject.effectId !== effect.id) {
      throw new EffectError("OBSERVATION_EFFECT_MISMATCH");
    }
    if (subject.taskId !== effect.taskId || subject.intentId !== effect.intentId ||
      subject.executionId !== effect.executionId || !sameIds(subject.resourceIds, effect.resourceIds)) {
      throw new EffectError("OBSERVATION_SUBJECT_MISMATCH");
    }
    if (observation.expectedPostconditionHash !== effect.expectedPostconditionHash ||
      postconditionHash(observation.expectedPostcondition) !== effect.expectedPostconditionHash) {
      throw new EffectError("OBSERVATION_SUBJECT_MISMATCH", "postcondition_mismatch");
    }
  }
  private emit(type: EffectEventType, effect: EffectTransaction,
    fromStatus?: EffectStatus, details: Record<string, unknown> = {}): void {
    this.events.append({ type, effectId: effect.id, taskId: effect.taskId,
      fromStatus, toStatus: effect.status, effectVersion: effect.version,
      at: this.clock.now(), details });
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
