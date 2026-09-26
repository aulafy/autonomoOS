import type { EffectStore } from "@agent-world/effects";
import type { BudgetLedgerStore } from "@agent-world/budgets";
import type { RecoveryAction, RecoveryActionKind, RecoveryPlan } from "./types.js";

/** Builds a fact-only plan. No saved decision here confers permission to dispatch. */
export class RecoveryPlanner {
  constructor(private readonly effects: EffectStore, private readonly now: () => number,
    private readonly budgets?: BudgetLedgerStore) {}

  plan(id: string): RecoveryPlan {
    const actions: RecoveryAction[] = [];
    const add = (effectId: string, observedVersion: number,
      kind: RecoveryActionKind): void => {
      actions.push({ id: `${kind}:${effectId}`, effectId, kind, observedVersion });
    };
    for (const effect of [...this.effects.list()].sort((a, b) => a.id.localeCompare(b.id))) {
      if (effect.status === "preparing" || effect.status === "prepared") {
        add(effect.id, effect.version, "cleanup_pre_dispatch");
      } else if (effect.status === "dispatching") {
        add(effect.id, effect.version, "mark_dispatching_unknown");
        add(effect.id, effect.version, "ensure_reconciliation");
      } else if (effect.status === "unknown") {
        add(effect.id, effect.version, "ensure_reconciliation");
      } else if (effect.status === "committed") {
        add(effect.id, effect.version, "repair_committed_budget");
      } else if (effect.status === "failed") {
        add(effect.id, effect.version, "cleanup_failed_budget");
      }
    }
    for (const reservation of this.budgets?.listReservations() ?? []) {
      if (reservation.status === "active" && reservation.effectId &&
        !this.effects.get(reservation.effectId)) {
        actions.push({ id: `cleanup_orphan_reservation:${reservation.id}`,
          effectId: reservation.effectId, kind: "cleanup_orphan_reservation",
          observedVersion: reservation.version, reservationId: reservation.id });
      }
    }
    return { id, createdAt: this.now(), actions };
  }
}
