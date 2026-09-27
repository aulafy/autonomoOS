import type { createDurableDomainStores } from "@agent-world/runtime-store-sqlite";

type Stores = Pick<ReturnType<typeof createDurableDomainStores>,
  "effects" | "effectEvents" | "observations" | "reconciliations" | "budgets" | "tasks">;

/** A deliberately narrow, read-only view of authoritative control facts. */
export function operatorSnapshot(stores: Stores, limit = 20) {
  const selected = [...stores.effects.list()]
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    .slice(0, Math.max(0, Math.min(50, Math.floor(limit))));
  const events = stores.effectEvents.list();
  return { generatedAt: Date.now(), effects: selected.map(effect => ({
    id: effect.id,
    taskId: effect.taskId,
    action: effect.action,
    resourceIds: effect.resourceIds,
    status: effect.status,
    createdAt: effect.createdAt,
    settledAt: effect.settledAt ?? null,
    taskStatus: stores.tasks.get(effect.taskId)?.status ?? null,
    reservationStatuses: effect.budgetReservationIds.map(id =>
      stores.budgets.getReservation(id)?.status ?? "missing"),
    transitions: events.filter(event => event.effectId === effect.id)
      .map(event => ({ type: event.type, status: event.toStatus, at: event.at })),
    observations: stores.observations.listByEffect(effect.id)
      .map(observation => ({ status: observation.status,
        source: observation.source, at: observation.observedAt })),
    reconciliation: {
      jobStatus: stores.reconciliations.findByEffect(effect.id)?.status ?? null,
      decisions: stores.reconciliations.listDecisions(effect.id)
        .map(decision => ({ outcome: decision.outcome, at: decision.at }))
    }
  })) };
}
