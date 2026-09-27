import type { EffectTransaction } from "@agent-world/effects";
import type { ReconcileResult, Reconciler } from "@agent-world/reconciliation";
import type { FilesystemObserver } from "./observer.js";

/** Read-only reality check. It does not receive a writer or retry capability. */
export class FilesystemReconciler implements Reconciler {
  readonly id = "filesystem-reconciler";
  constructor(private readonly observer: FilesystemObserver) {}
  supports(effect: EffectTransaction): boolean {
    return effect.executorId === "filesystem-write" || effect.executorId === "filesystem-read";
  }
  async reconcile(effect: EffectTransaction, _attempt: number,
    signal: AbortSignal): Promise<ReconcileResult> {
    const observation = await this.observer.observe({
      subject: { taskId: effect.taskId, intentId: effect.intentId,
        executionId: effect.executionId, effectId: effect.id,
        resourceIds: [...effect.resourceIds] },
      expectedPostcondition: effect.expectedPostcondition,
      context: { resourceIds: [...effect.resourceIds],
        externalReference: effect.externalReference }
    }, signal);
    return { kind: "observations", observations: [observation] };
  }
}
