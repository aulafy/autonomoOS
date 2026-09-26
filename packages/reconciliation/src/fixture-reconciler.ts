import type { EffectTransaction } from "@agent-world/effects";
import type { Reconciler, ReconcileResult } from "./reconciliation.js";

/** Deterministic lookup fixture; it never invokes an effect executor. */
export class FixtureReconciler implements Reconciler {
  readonly id = "fixture-reconciler";
  readonly lookups: string[] = [];
  constructor(private readonly result: ReconcileResult | readonly ReconcileResult[]) {}
  supports(): boolean { return true; }
  async reconcile(effect: EffectTransaction, _attempt: number, signal: AbortSignal): Promise<ReconcileResult> {
    signal.throwIfAborted();
    this.lookups.push(effect.id);
    const selected = Array.isArray(this.result)
      ? this.result[Math.min(this.lookups.length - 1, this.result.length - 1)]
      : this.result;
    return structuredClone(selected) as ReconcileResult;
  }
}
