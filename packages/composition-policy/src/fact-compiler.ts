import type { ContractRisk } from "@agent-world/contracts";
import type { EffectStore, EffectTransaction } from "@agent-world/effects";
import type { ObservationPolicy, ObservationStore, ObserverRegistry } from "@agent-world/observation";
import type { ActionRegistry } from "./action-registry.js";
import type { HistoryStore } from "./history-store.js";
import { CompositionError, type FactKind, type HistoryFact } from "./types.js";

export interface ObservationFactPolicy {
  riskClass: ContractRisk;
  maxAgeMs: number;
  requireGenerationBinding?: boolean;
}

export type ObservationFactKind = "secret_observed" | "sensitive_read" | "credential_access";

/** Projects trusted C5/C6 records into task history; never changes those records. */
export class FactCompiler {
  constructor(private readonly history: HistoryStore, private readonly effects: EffectStore,
    private readonly observations: ObservationStore, private readonly observers: ObserverRegistry,
    private readonly policy: ObservationPolicy, private readonly actions: ActionRegistry,
    private readonly observationKinds: Readonly<Record<string, ObservationFactKind>>) {}

  fromEffect(effectId: string): HistoryFact | null {
    return this.fromEffectFacts(effectId)[0] ?? null;
  }

  fromEffectFacts(effectId: string): HistoryFact[] {
    const effect = this.effects.get(effectId);
    if (!effect) throw new CompositionError("EFFECT_NOT_FOUND");
    const actionClass = this.actions.get(effect.action)?.actionClass;
    const kinds: FactKind[] = [];
    if (actionClass === "payment" && effect.dispatchStartedAt !== undefined) {
      kinds.push("payment_attempted");
    }
    if (actionClass === "external_send" && effect.dispatchStartedAt !== undefined) {
      kinds.push("external_send_attempted");
    }
    if (effect.status === "committed") {
      const committedKind = actionClass === "sensitive_read" ? "sensitive_read" :
        actionClass === "credential_access" ? "credential_access" :
        actionClass === "untrusted_code_execution" ? "untrusted_code_executed" :
        actionClass === "external_send" ? "external_send_committed" : null;
      if (committedKind) kinds.push(committedKind);
    }
    return kinds.map(kind => this.recordEffectFact(effect, kind));
  }

  fromObservation(observationId: string, requirement: ObservationFactPolicy): HistoryFact | null {
    const observation = this.observations.get(observationId);
    if (!observation) throw new CompositionError("OBSERVATION_NOT_FOUND");
    const kind = this.observationKinds[observation.expectedPostcondition.kind];
    if (!kind || observation.status !== "confirmed") return null;
    const observer = this.observers.get(observation.observerId);
    if (!observer) return null;
    const evaluation = this.policy.evaluate(observation, observer.descriptor, {
      subject: observation.subject, expectedPostcondition: observation.expectedPostcondition,
      riskClass: requirement.riskClass, maxAgeMs: requirement.maxAgeMs,
      requireGenerationBinding: requirement.requireGenerationBinding
    });
    if (!evaluation.accepted || evaluation.effectiveStatus !== "confirmed") return null;
    const id = `observation:${observation.id}:${kind}`;
    const existing = this.history.get(id);
    if (existing) return existing;
    return this.history.append({ id, taskId: observation.subject.taskId, kind,
      occurredAt: observation.observedAt, source: "accepted_observation",
      sourceId: observation.id, effectId: observation.subject.effectId,
      resourceIds: [...observation.subject.resourceIds], metadata: {
        observerId: observation.observerId, evaluationReason: evaluation.reasonCode
      } });
  }

  private recordEffectFact(effect: EffectTransaction, kind: FactKind): HistoryFact {
    const id = `effect:${effect.id}:${kind}`;
    const existing = this.history.get(id);
    if (existing) return existing;
    return this.history.append({ id, taskId: effect.taskId, kind,
      occurredAt: kind === "payment_attempted" || kind === "external_send_attempted"
        ? effect.dispatchStartedAt! : effect.settledAt!,
      source: kind === "payment_attempted" || kind === "external_send_attempted"
        ? "effect_attempt" : "committed_effect",
      sourceId: effect.id, effectId: effect.id, resourceIds: [...effect.resourceIds],
      metadata: { action: effect.action, statusAtProjection: effect.status } });
  }
}
