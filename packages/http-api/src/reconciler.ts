import type { EffectTransaction } from "@agent-world/effects";
import type { ReconcileResult, Reconciler } from "@agent-world/reconciliation";
import type { HttpApiObserver } from "./observer.js";

/** Its only capability is the observer's GET lookup. */
export class HttpApiReconciler implements Reconciler {
  readonly id = "restricted-http-reconciler";
  constructor(private readonly observer: HttpApiObserver) {}
  supports(effect: EffectTransaction): boolean {
    return effect.executorId === "restricted-http-api";
  }
  async reconcile(effect: EffectTransaction, _attempt: number,
    signal: AbortSignal): Promise<ReconcileResult> {
    const observation = await this.observer.observe({ subject: {
      taskId: effect.taskId, intentId: effect.intentId,
      executionId: effect.executionId, effectId: effect.id,
      resourceIds: [...effect.resourceIds] },
      expectedPostcondition: effect.expectedPostcondition,
      context: { resourceIds: [...effect.resourceIds],
        externalReference: effect.externalReference } }, signal);
    const certificate = observation.metadata.certificate;
    return { kind: "observations", observations: [observation],
      ...(certificate && typeof certificate === "object" ?
        { noEffectCertificate: certificate as Extract<ReconcileResult,
          { kind: "observations" }>["noEffectCertificate"] } : {}) };
  }
}
