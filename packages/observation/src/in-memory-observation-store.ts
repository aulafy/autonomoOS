import { isCanonicalResourceId } from "@agent-world/resources";
import { postconditionHash } from "./expected-postcondition.js";
import type { Observation } from "./observation.js";
import type { ObservationStore } from "./observation-store.js";
import { ObservationError } from "./errors.js";

const statuses = new Set(["confirmed", "contradicted", "unknown", "inconclusive", "stale"]);

export class InMemoryObservationStore implements ObservationStore {
  private readonly byId = new Map<string, Observation>();
  append(observation: Observation): Observation {
    let expectedHash: string | null = null;
    try {
      if (observation?.expectedPostcondition) {
        expectedHash = postconditionHash(observation.expectedPostcondition);
      }
    } catch {
      throw new ObservationError("INVALID_OBSERVER_RESULT");
    }
    if (!observation || typeof observation !== "object" ||
      !observation.id || !observation.observerId || !observation.subject?.taskId ||
      !Array.isArray(observation.subject.resourceIds) ||
      observation.subject.resourceIds.some(id => !isCanonicalResourceId(id)) ||
      !statuses.has(observation.status) || !Number.isFinite(observation.observedAt) ||
      !Array.isArray(observation.evidence) || !observation.reason ||
      !observation.expectedPostcondition ||
      observation.expectedPostconditionHash !== expectedHash) {
      throw new ObservationError("INVALID_OBSERVER_RESULT");
    }
    if (this.byId.has(observation.id)) throw new ObservationError("DUPLICATE_OBSERVATION_ID", observation.id);
    const stored = structuredClone(observation);
    this.byId.set(stored.id, stored);
    return structuredClone(stored);
  }
  get(id: string): Observation | null {
    const value = this.byId.get(id);
    return value ? structuredClone(value) : null;
  }
  list(): readonly Observation[] { return [...this.byId.values()].map(value => structuredClone(value)); }
  listByTask(taskId: string): readonly Observation[] {
    return this.list().filter(value => value.subject.taskId === taskId);
  }
  listByExecution(executionId: string): readonly Observation[] {
    return this.list().filter(value => value.subject.executionId === executionId);
  }
  listByEffect(effectId: string): readonly Observation[] {
    return this.list().filter(value => value.subject.effectId === effectId);
  }
}
