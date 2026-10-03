import { CapabilityRegistry } from "@agent-world/capabilities";
import { canonicalRouting, route } from "./router.js";
import type { RoutingDecision } from "./types.js";
/** Immutable audit records. Recompute from captured inputs before accepting them. */
export class RoutingDecisionStore {
  private records = new Map<string, RoutingDecision>();
  record(input: RoutingDecision): { decisionId: string } {
    const decision = structuredClone(input);
    const reconstructed = route(decision.input, new CapabilityRegistry(decision.capabilitySnapshot));
    if (canonicalRouting(reconstructed) !== canonicalRouting(decision)) throw new Error("ROUTING_DECISION_NOT_REPRODUCIBLE");
    const previous = this.records.get(decision.id);
    if (previous && canonicalRouting(previous) !== canonicalRouting(decision)) throw new Error("ROUTING_DECISION_ID_CONFLICT");
    this.records.set(decision.id, decision);
    return { decisionId: decision.id };
  }
  get(id: string): RoutingDecision | undefined { const value = this.records.get(id); return value ? structuredClone(value) : undefined; }
  list(taskId?: string): RoutingDecision[] { return [...this.records.values()].filter(value => taskId === undefined || value.taskId === taskId).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(value => structuredClone(value)); }
}
