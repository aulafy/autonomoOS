import type { EffectStatus } from "./effect-status.js";
import type { EffectTransaction } from "./effect-transaction.js";

export interface EffectStore {
  create(effect: EffectTransaction): EffectTransaction;
  get(id: string): EffectTransaction | null;
  update(next: EffectTransaction, expectedVersion: number): EffectTransaction;
  list(): readonly EffectTransaction[];
  listByTask(taskId: string): readonly EffectTransaction[];
  listByIntent(intentId: string): readonly EffectTransaction[];
  listByStatus(status: EffectStatus): readonly EffectTransaction[];
  findByIdempotencyKey(key: string): EffectTransaction | null;
}
