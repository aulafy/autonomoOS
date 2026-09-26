import { isCanonicalResourceId } from "@agent-world/resources";
import { CompositionError, type HistoryFact } from "./types.js";

export interface HistoryStore {
  append(fact: HistoryFact): HistoryFact;
  get(id: string): HistoryFact | null;
  listByTask(taskId: string): readonly HistoryFact[];
  currentVersion(taskId: string): number;
}

/** Host control-plane store. Callers must compile facts from trusted records. */
export class InMemoryHistoryStore implements HistoryStore {
  private readonly facts = new Map<string, HistoryFact>();
  private readonly versions = new Map<string, number>();

  append(fact: HistoryFact): HistoryFact {
    if (!fact?.id || !fact.taskId || !fact.sourceId ||
      !["committed_effect", "effect_attempt", "accepted_observation", "trusted_control_event"]
        .includes(fact.source) ||
      !["sensitive_read", "secret_observed", "credential_access", "untrusted_code_executed",
        "payment_attempted", "external_send_attempted", "external_send_committed"]
        .includes(fact.kind) ||
      !Number.isFinite(fact.occurredAt) || fact.occurredAt < 0 ||
      !Array.isArray(fact.resourceIds) || fact.resourceIds.some(id => !isCanonicalResourceId(id)) ||
      new Set(fact.resourceIds).size !== fact.resourceIds.length ||
      !fact.metadata || typeof fact.metadata !== "object" || Array.isArray(fact.metadata)) {
      throw new CompositionError("INVALID_HISTORY_FACT");
    }
    if ((fact.source === "effect_attempt" &&
        !["payment_attempted", "external_send_attempted"].includes(fact.kind)) ||
      (fact.source === "committed_effect" && !["sensitive_read", "credential_access",
        "untrusted_code_executed", "external_send_committed"].includes(fact.kind)) ||
      (fact.source === "accepted_observation" && !["secret_observed", "sensitive_read",
        "credential_access"].includes(fact.kind))) {
      throw new CompositionError("INVALID_HISTORY_FACT");
    }
    if (this.facts.has(fact.id)) throw new CompositionError("HISTORY_FACT_EXISTS");
    const stored = structuredClone(fact);
    this.facts.set(stored.id, stored);
    this.versions.set(stored.taskId, this.currentVersion(stored.taskId) + 1);
    return structuredClone(stored);
  }

  get(id: string): HistoryFact | null {
    const fact = this.facts.get(id);
    return fact ? structuredClone(fact) : null;
  }
  listByTask(taskId: string): readonly HistoryFact[] {
    return [...this.facts.values()].filter(fact => fact.taskId === taskId)
      .map(fact => structuredClone(fact));
  }
  currentVersion(taskId: string): number { return this.versions.get(taskId) ?? 0; }
}
