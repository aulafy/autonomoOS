import { isCanonicalResourceId } from "@agent-world/resources";
import { postconditionHash } from "@agent-world/observation";
import { effectIdempotencyKey } from "./idempotency.js";
import { EFFECT_TRANSITIONS, type EffectStatus } from "./effect-status.js";
import type { EffectTransaction } from "./effect-transaction.js";
import type { EffectStore } from "./effect-store.js";
import { EffectError } from "./errors.js";
import { stableJson } from "./stable-json.js";

function immutablePart(effect: EffectTransaction): unknown {
  return {
    id: effect.id, taskId: effect.taskId, sessionContractId: effect.sessionContractId ?? null,
    intentId: effect.intentId, executionId: effect.executionId, executorId: effect.executorId,
    action: effect.action, parameters: effect.parameters,
    expectedPostcondition: effect.expectedPostcondition,
    expectedPostconditionHash: effect.expectedPostconditionHash,
    idempotencyKey: effect.idempotencyKey, resourceIds: effect.resourceIds,
    resourceFences: effect.resourceFences, capabilityGrantIds: effect.capabilityGrantIds,
    authorityLeaseIds: effect.authorityLeaseIds, resourceLeaseIds: effect.resourceLeaseIds,
    budgetReservationIds: effect.budgetReservationIds, policyDecisionId: effect.policyDecisionId ?? null,
    compositionDecisionId: effect.compositionDecisionId ?? null,
    flowDecisionId: effect.flowDecisionId ?? null, createdAt: effect.createdAt,
    metadata: effect.metadata
  };
}

export class InMemoryEffectStore implements EffectStore {
  private readonly byId = new Map<string, EffectTransaction>();
  private readonly byKey = new Map<string, string>();

  create(effect: EffectTransaction): EffectTransaction {
    this.validateCreate(effect);
    if (this.byId.has(effect.id)) throw new EffectError("EFFECT_ALREADY_EXISTS", effect.id);
    if (this.byKey.has(effect.idempotencyKey)) {
      throw new EffectError("EFFECT_IDEMPOTENCY_CONFLICT", effect.idempotencyKey);
    }
    const stored = structuredClone(effect);
    this.byId.set(stored.id, stored);
    this.byKey.set(stored.idempotencyKey, stored.id);
    return structuredClone(stored);
  }

  get(id: string): EffectTransaction | null {
    const effect = this.byId.get(id);
    return effect ? structuredClone(effect) : null;
  }

  update(next: EffectTransaction, expectedVersion: number): EffectTransaction {
    const current = this.byId.get(next.id);
    if (!current) throw new EffectError("EFFECT_NOT_FOUND", next.id);
    if (current.version !== expectedVersion || next.version !== expectedVersion + 1) {
      throw new EffectError("VERSION_CONFLICT");
    }
    if (stableJson(immutablePart(current)) !== stableJson(immutablePart(next))) {
      throw new EffectError("INVALID_EFFECT_INPUT", "immutable_fields_changed");
    }
    const sameStatusReport = current.status === "dispatching" && next.status === "dispatching" &&
      current.dispatchResult === undefined && next.dispatchResult?.kind === "reported_success";
    if (!sameStatusReport && !EFFECT_TRANSITIONS[current.status].includes(next.status)) {
      throw new EffectError("INVALID_EFFECT_TRANSITION", `${current.status}->${next.status}`);
    }
    if (next.observationIds.length < current.observationIds.length ||
      current.observationIds.some((id, index) => next.observationIds[index] !== id)) {
      throw new EffectError("INVALID_EFFECT_INPUT", "observation_history_rewritten");
    }
    if (next.status === "committed" &&
      (next.observationIds.length === 0 || !next.settlementEvaluation?.accepted ||
        next.settlementEvaluation.effectiveStatus !== "confirmed")) {
      throw new EffectError("INVALID_EFFECT_TRANSITION", "commit_requires_accepted_observation");
    }
    if (current.status === "unknown" && next.status === "committed" &&
      !next.reconciliationDecisionId) {
      throw new EffectError("INVALID_EFFECT_TRANSITION", "reconciliation_decision_required");
    }
    if (next.status === "prepared" && !Number.isFinite(next.preparedAt)) {
      throw new EffectError("INVALID_EFFECT_TRANSITION", "prepare_timestamp_missing");
    }
    if (current.status === "prepared" && next.status === "dispatching" &&
      !Number.isFinite(next.dispatchStartedAt)) {
      throw new EffectError("INVALID_EFFECT_TRANSITION", "dispatch_boundary_missing");
    }
    if (next.status === "failed") {
      const certified = next.failureCertainty === "certified_not_started" ||
        next.failureCertainty === "certified_no_effect" &&
        current.status === "unknown" && !!next.reconciliationDecisionId &&
        next.settlementEvaluation?.accepted === true &&
        next.settlementEvaluation.effectiveStatus === "contradicted" &&
        next.observationIds.length > 0;
      const contradicted = next.settlementEvaluation?.accepted === true &&
        next.settlementEvaluation.effectiveStatus === "contradicted" &&
        next.observationIds.length > 0;
      if ((current.status === "dispatching" && !certified && !contradicted) ||
        (current.status !== "dispatching" && !certified)) {
        throw new EffectError("INVALID_EFFECT_TRANSITION", "failure_certainty_missing");
      }
    }
    if (next.status === "unknown" && !next.unknownReasonCode) {
      throw new EffectError("INVALID_EFFECT_TRANSITION", "unknown_reason_missing");
    }
    const stored = structuredClone(next);
    this.byId.set(stored.id, stored);
    return structuredClone(stored);
  }

  list(): readonly EffectTransaction[] { return [...this.byId.values()].map(effect => structuredClone(effect)); }
  listByTask(taskId: string): readonly EffectTransaction[] {
    return this.list().filter(effect => effect.taskId === taskId);
  }
  listByIntent(intentId: string): readonly EffectTransaction[] {
    return this.list().filter(effect => effect.intentId === intentId);
  }
  listByStatus(status: EffectStatus): readonly EffectTransaction[] {
    return this.list().filter(effect => effect.status === status);
  }
  findByIdempotencyKey(key: string): EffectTransaction | null {
    const id = this.byKey.get(key);
    return id ? this.get(id) : null;
  }

  private validateCreate(effect: EffectTransaction): void {
    if (!effect || !effect.id || !effect.taskId || !effect.intentId || !effect.executionId ||
      !effect.executorId || !effect.action || !effect.idempotencyKey ||
      effect.status !== "preparing" || effect.version !== 1 ||
      !Number.isFinite(effect.createdAt) || effect.createdAt < 0 ||
      !Array.isArray(effect.resourceIds) ||
      effect.resourceIds.some(id => !isCanonicalResourceId(id)) ||
      new Set(effect.resourceIds).size !== effect.resourceIds.length ||
      !Array.isArray(effect.observationIds) || effect.observationIds.length !== 0 ||
      !effect.expectedPostcondition || !effect.resourceFences ||
      !Array.isArray(effect.resourceLeaseIds) ||
      !Array.isArray(effect.capabilityGrantIds) ||
      !Array.isArray(effect.authorityLeaseIds) ||
      !Array.isArray(effect.budgetReservationIds)) {
      throw new EffectError("INVALID_EFFECT_INPUT");
    }
    try {
      if (effect.expectedPostconditionHash !== postconditionHash(effect.expectedPostcondition) ||
        effect.idempotencyKey !== effectIdempotencyKey(effect)) {
        throw new EffectError("INVALID_EFFECT_INPUT", "semantic_binding_mismatch");
      }
      stableJson(immutablePart(effect));
    } catch (error) {
      if (error instanceof EffectError) throw error;
      throw new EffectError("INVALID_EFFECT_INPUT");
    }
    for (const [id, token] of Object.entries(effect.resourceFences)) {
      if (!effect.resourceIds.includes(id as typeof effect.resourceIds[number]) ||
        !/^[1-9]\d*$/.test(token)) throw new EffectError("INVALID_EFFECT_INPUT", "invalid_fence");
    }
    if (effect.resourceLeaseIds.length > 0 && Object.keys(effect.resourceFences).length === 0) {
      throw new EffectError("INVALID_EFFECT_INPUT", "missing_resource_fence");
    }
  }
}
