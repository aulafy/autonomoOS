import type { createDurableDomainStores } from "@agent-world/runtime-store-sqlite";
import type { RuntimeEvent } from "@agent-world/protocol";

type Stores = Pick<ReturnType<typeof createDurableDomainStores>,
  "effects" | "effectEvents" | "observations" | "reconciliations" | "budgets" | "tasks">;
type OperatorEventReader = {
  byTask(taskId: string): readonly RuntimeEvent[];
  recentDenials(): readonly RuntimeEvent[];
};

const taskEventTypes = new Set<RuntimeEvent["type"]>([
  "task.created", "inference.requested", "inference.completed",
  "plan.proposed", "plan.accepted", "action.proposed"
]);
const controlTimelineTypes = new Set([
  "action.admitted", "action.commit_allowed", "action.admission_denied",
  "action.commit_denied", "effect.prepared", "effect.dispatching",
  "effect.dispatch_reported", "effect.committed", "effect.failed", "effect.unknown"
]);

function safeTaskId(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value : null;
}

const visibleReasonCodes = new Set([
  "GRANT_REVOKED", "GRANT_EXPIRED", "CONTRACT_DENIED", "POLICY_DENIED",
  "COMPOSITION_DENIED", "COMPOSITION_APPROVAL_REQUIRED", "FLOW_DENIED",
  "RELEASE_APPROVAL_REQUIRED", "BUDGET_NOT_ACTIVE",
  "BUDGET_RESERVATION_NOT_ACTIVE", "SUPERVISOR_STOP", "TASK_NOT_RUNNABLE",
  "RUNTIME_READ_ONLY", "INVALID_API_REQUEST", "INVALID_GOAL_REQUEST",
  "ACTION_NOT_EXPOSED", "PROPOSAL_TARGET_OUT_OF_SCOPE",
  "TARGET_NOT_HOST_ALLOWED", "EXPECTED_CONTENT_MISMATCH",
  "INFERENCE_FLOW_DENIED", "DEMO_ACTION_NOT_REGISTERED"
]);
const visibleVerdicts = new Set(["allow", "deny", "require_approval",
  "require_release_approval", "not_required"]);
const safeReasonCode = (value: unknown) => typeof value === "string" &&
  visibleReasonCodes.has(value) ? value : null;
const safeVerdict = (value: unknown) => typeof value === "string" &&
  visibleVerdicts.has(value) ? value : null;

/** A deliberately narrow, read-only view of authoritative control facts. */
export function operatorSnapshot(stores: Stores,
  runtimeEvents: readonly RuntimeEvent[] | OperatorEventReader = [], limit = 20) {
  const selected = [...stores.effects.list()]
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
    .slice(0, Math.max(0, Math.min(50, Math.floor(limit))));
  const events = stores.effectEvents.list();
  const denialEvents = Array.isArray(runtimeEvents)
    ? runtimeEvents : (runtimeEvents as OperatorEventReader).recentDenials();
  const denials = denialEvents.flatMap(event => {
    if (event.type === "policy.denied") {
      return [{ type: event.type, at: event.timestamp,
        taskId: safeTaskId(event.taskId),
        reasonCode: safeReasonCode(event.payload.reasonCode ?? event.payload.reason) }];
    }
    if (event.type === "control.event" &&
      ["action.admission_denied", "action.commit_denied"]
        .includes(String(event.payload.controlEventType))) {
      const raw = event.payload.detail;
      const detail = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, unknown> : {};
      return [{ type: String(event.payload.controlEventType),
        at: event.timestamp, taskId: safeTaskId(event.taskId),
        reasonCode: safeReasonCode(detail.reasonCode ?? event.payload.reasonCode) }];
    }
    return [];
  }).slice(-20).reverse();
  return { generatedAt: Date.now(), denials, effects: selected.map(effect => ({
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
    taskEvents: (Array.isArray(runtimeEvents) ? runtimeEvents
      : (runtimeEvents as OperatorEventReader).byTask(effect.taskId))
      .filter(event => event.taskId === effect.taskId &&
      (!event.intentId || event.intentId === effect.intentId))
      .flatMap(event => {
        if (taskEventTypes.has(event.type)) {
          const detail = event.type === "plan.proposed" &&
            Array.isArray(event.payload.actions)
            ? `${event.payload.actions.length} action(s)` : null;
          return [{ type: event.type, at: event.timestamp, detail }];
        }
        if (event.type !== "control.event" ||
          event.payload.effectId !== effect.id ||
          !controlTimelineTypes.has(String(event.payload.controlEventType))) return [];
        const type = String(event.payload.controlEventType);
        const raw = event.payload.detail;
        const details = raw && typeof raw === "object" && !Array.isArray(raw)
          ? raw as Record<string, unknown> : {};
        const detail = type === "action.admitted"
          ? [safeVerdict(details.composition), safeVerdict(details.flow)]
            .filter(Boolean).join(" / ") || null
          : type === "action.commit_allowed" ? "durable dispatch marker"
          : safeReasonCode(details.reasonCode);
        return [{ type, at: event.timestamp, detail }];
      }).slice(-30),
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
