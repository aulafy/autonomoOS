import type { EffectTransaction } from "@agent-world/effects";
import { ReconciliationError } from "./reconciliation-queue.js";
import type { ReconciliationDecision, ReconciliationOutcome } from "./reconciliation.js";

export type EffectiveEffectOutcome = "committed" | "failed" | "unknown";

export interface EffectResolution {
  effectId: string;
  originalEffectStatus: EffectTransaction["status"];
  effectiveOutcome: EffectiveEffectOutcome;
  reconciliationOutcome?: ReconciliationOutcome;
  latestDecisionId?: string;
  resolvedByDecisionId?: string;
  resolvedAt?: number;
}

/** Deterministic read model. C6 history is never mutated. */
export function resolveEffectiveEffectOutcome(
  effect: EffectTransaction, decisions: readonly ReconciliationDecision[]
): EffectResolution {
  const relevant = decisions.filter(decision => decision.effectId === effect.id);
  if (effect.status !== "unknown") {
    if (relevant.length) throw new ReconciliationError("INVALID_RECONCILIATION_HISTORY");
    return { effectId: effect.id, originalEffectStatus: effect.status,
      effectiveOutcome: effect.status === "committed" ? "committed" :
        effect.status === "failed" ? "failed" : "unknown" };
  }
  if (!relevant.length) return { effectId: effect.id, originalEffectStatus: "unknown",
    effectiveOutcome: "unknown" };
  const byId = new Map(relevant.map(decision => [decision.id, decision]));
  if (byId.size !== relevant.length) throw new ReconciliationError("INVALID_RECONCILIATION_HISTORY");
  const superseded = new Set<string>();
  for (const decision of relevant) {
    if (!decision.supersedesDecisionId) continue;
    const previous = byId.get(decision.supersedesDecisionId);
    if (!previous || previous.id === decision.id || previous.attempt >= decision.attempt ||
      superseded.has(previous.id)) throw new ReconciliationError("INVALID_RECONCILIATION_HISTORY");
    superseded.add(previous.id);
  }
  const heads = relevant.filter(decision => !superseded.has(decision.id));
  if (heads.length !== 1) throw new ReconciliationError("INVALID_RECONCILIATION_HISTORY");
  const latest = heads[0];
  if ((latest.outcome === "confirmed_effect" && latest.observationIds.length === 0) ||
    (latest.outcome === "confirmed_no_effect" &&
      (latest.observationIds.length === 0 ||
        latest.noEffectCertificate?.kind !== "idempotency_key_never_processed" ||
        latest.noEffectCertificate.idempotencyKey !== effect.idempotencyKey ||
        !latest.noEffectCertificate.authority || !latest.noEffectCertificate.reference)) ||
    (latest.outcome === "superseded" && !latest.supersessionReference)) {
    throw new ReconciliationError("INVALID_RECONCILIATION_HISTORY");
  }
  const effectiveOutcome: EffectiveEffectOutcome = latest.outcome === "confirmed_effect"
    ? "committed" : latest.outcome === "confirmed_no_effect" ? "failed" : "unknown";
  return { effectId: effect.id, originalEffectStatus: "unknown", effectiveOutcome,
    reconciliationOutcome: latest.outcome, latestDecisionId: latest.id,
    resolvedByDecisionId: effectiveOutcome === "unknown" ? undefined : latest.id,
    resolvedAt: effectiveOutcome === "unknown" ? undefined : latest.at };
}
