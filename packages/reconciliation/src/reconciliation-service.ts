import type { ContractRisk } from "@agent-world/contracts";
import type { EffectStore, EffectTransaction } from "@agent-world/effects";
import { postconditionHash, type Observation, type ObservationPolicy,
  type ObservationStore, type ObserverRegistry } from "@agent-world/observation";
import { InMemoryReconciliationQueue, ReconciliationError } from "./reconciliation-queue.js";
import type { Reconciler, ReconciliationDecision, ReconciliationJob,
  ReconciliationOutcome, ReconcileResult } from "./reconciliation.js";

export interface ReconciliationPolicyOptions {
  riskClass: ContractRisk;
  maxAgeMs: number;
  requireGenerationBinding?: boolean;
}

export class ReconciliationService {
  constructor(
    private readonly effects: EffectStore,
    private readonly queue: InMemoryReconciliationQueue,
    private readonly observations: ObservationStore,
    private readonly observers: ObserverRegistry,
    private readonly policy: ObservationPolicy,
    private readonly reconcilers: readonly Reconciler[],
    private readonly now: () => number
  ) {}

  enqueue(id: string, effectId: string, maxAttempts: number): ReconciliationJob {
    const effect = this.requireUnknown(effectId);
    if (!id || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
      throw new ReconciliationError("INVALID_RECONCILIATION_JOB");
    }
    const at = this.now();
    return this.queue.enqueue({ id, effectId: effect.id, attempts: 0, maxAttempts,
      nextAttemptAt: at, status: "queued", createdAt: at, updatedAt: at, version: 1 });
  }

  async run(jobId: string, options: ReconciliationPolicyOptions,
    signal: AbortSignal = new AbortController().signal): Promise<ReconciliationDecision> {
    const job = this.queue.get(jobId);
    if (!job) throw new ReconciliationError("RECONCILIATION_NOT_FOUND");
    if (job.status !== "queued" || job.nextAttemptAt > this.now()) {
      throw new ReconciliationError("RECONCILIATION_NOT_READY");
    }
    const effect = this.requireUnknown(job.effectId);
    const reconciler = this.reconcilers.find(candidate => candidate.supports(effect));
    if (!reconciler) throw new ReconciliationError("RECONCILER_NOT_FOUND");
    const running = this.queue.update({ ...job, status: "running", attempts: job.attempts + 1,
      updatedAt: this.now(), version: job.version + 1 }, job.version);
    let result: ReconcileResult;
    try {
      result = await reconciler.reconcile(structuredClone(effect), running.attempts, signal);
    } catch {
      result = { kind: "observations", observations: [] };
    }
    let outcome: ReconciliationOutcome;
    let reason: string;
    let observationIds: string[] = [];
    if (result.kind === "superseded") {
      outcome = result.reason.trim() && result.reference.trim() ? "superseded" : "ambiguous";
      reason = outcome === "superseded" ? result.reason : "UNVERIFIED_SUPERSESSION";
    } else {
      let evaluated: ReturnType<ReconciliationService["evaluate"]>;
      try {
        evaluated = this.evaluate(effect, result.observations, options);
      } catch {
        evaluated = { outcome: "ambiguous", reason: "RECONCILIATION_LOOKUP_INVALID",
          observationIds: [] };
      }
      outcome = evaluated.outcome === "confirmed_no_effect" && !this.validCertificate(effect, result)
        ? "ambiguous" : evaluated.outcome;
      reason = outcome === "ambiguous" && evaluated.outcome === "confirmed_no_effect"
        ? "POSTCONDITION_ABSENCE_NOT_CERTIFIED" : evaluated.reason;
      observationIds = evaluated.observationIds;
    }
    const previous = this.queue.listDecisions(effect.id).at(-1);
    const decision = this.queue.appendDecision({
      id: `${job.id}:${running.attempts}`, jobId: job.id, effectId: effect.id,
      attempt: running.attempts, outcome, observationIds, reason,
      reconcilerId: reconciler.id, at: this.now(),
      supersedesDecisionId: previous?.id,
      noEffectCertificate: outcome === "confirmed_no_effect" && result.kind === "observations"
        ? result.noEffectCertificate : undefined,
      supersessionReference: outcome === "superseded" && result.kind === "superseded"
        ? result.reference : undefined
    });
    const settled = outcome === "ambiguous" && running.attempts < running.maxAttempts
      ? "queued" : outcome === "ambiguous" || outcome === "conflicting" ? "exhausted" : "resolved";
    const delay = result.kind === "observations" && result.retryAfterMs !== undefined &&
      Number.isFinite(result.retryAfterMs) && result.retryAfterMs >= 0
      ? result.retryAfterMs : 1000;
    this.queue.update({ ...running, status: settled,
      nextAttemptAt: settled === "queued" ? this.now() + delay : running.nextAttemptAt,
      updatedAt: this.now(), version: running.version + 1 }, running.version);
    return decision;
  }

  private requireUnknown(effectId: string): EffectTransaction {
    const effect = this.effects.get(effectId);
    if (!effect) throw new ReconciliationError("EFFECT_NOT_FOUND");
    if (effect.status !== "unknown") throw new ReconciliationError("EFFECT_NOT_UNKNOWN");
    return effect;
  }

  private validCertificate(effect: EffectTransaction, result: Extract<ReconcileResult,
    { kind: "observations" }>): boolean {
    const certificate = result.noEffectCertificate;
    return certificate?.kind === "idempotency_key_never_processed" &&
      certificate.idempotencyKey === effect.idempotencyKey &&
      !!certificate.authority.trim() && !!certificate.reference.trim();
  }

  private evaluate(effect: EffectTransaction, candidates: readonly Observation[],
    options: ReconciliationPolicyOptions): {
      outcome: ReconciliationOutcome; reason: string; observationIds: string[]
    } {
    let confirmed = false;
    let contradicted = false;
    const observationIds: string[] = [];
    for (const candidate of candidates) {
      if (!this.isBound(effect, candidate)) continue;
      const observer = this.observers.get(candidate.observerId);
      if (!observer) continue;
      const existing = this.observations.get(candidate.id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(candidate)) {
        throw new ReconciliationError("OBSERVATION_ID_CONFLICT");
      }
      const recorded = existing ?? this.observations.append(candidate);
      observationIds.push(recorded.id);
    }
    for (const recorded of this.observations.listByEffect(effect.id)) {
      if (!this.isBound(effect, recorded)) continue;
      const observer = this.observers.get(recorded.observerId);
      if (!observer) continue;
      const evaluation = this.policy.evaluate(recorded, observer.descriptor, {
        subject: { taskId: effect.taskId, intentId: effect.intentId,
          executionId: effect.executionId, effectId: effect.id, resourceIds: effect.resourceIds },
        expectedPostcondition: effect.expectedPostcondition,
        riskClass: options.riskClass, maxAgeMs: options.maxAgeMs,
        requireGenerationBinding: options.requireGenerationBinding
      });
      if (evaluation.accepted && evaluation.effectiveStatus === "confirmed") confirmed = true;
      if (evaluation.accepted && evaluation.effectiveStatus === "contradicted") contradicted = true;
    }
    if (confirmed && contradicted) return { outcome: "conflicting", reason: "CONFLICTING_EVIDENCE", observationIds };
    if (confirmed) return { outcome: "confirmed_effect", reason: "EFFECT_CONFIRMED", observationIds };
    if (contradicted) return { outcome: "confirmed_no_effect", reason: "NO_EFFECT_CERTIFICATE_REQUIRED", observationIds };
    return { outcome: "ambiguous", reason: "INSUFFICIENT_RECONCILIATION_EVIDENCE", observationIds };
  }

  private isBound(effect: EffectTransaction, observation: Observation): boolean {
    const subject = observation.subject;
    const sorted = (ids: readonly string[]) => [...ids].sort().join("\u0000");
    return subject.effectId === effect.id && subject.taskId === effect.taskId &&
      subject.intentId === effect.intentId && subject.executionId === effect.executionId &&
      sorted(subject.resourceIds) === sorted(effect.resourceIds) &&
      observation.expectedPostconditionHash === effect.expectedPostconditionHash &&
      postconditionHash(observation.expectedPostcondition) === effect.expectedPostconditionHash;
  }
}
