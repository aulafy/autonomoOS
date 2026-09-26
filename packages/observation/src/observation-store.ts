import type { Observation } from "./observation.js";

export interface ObservationStore {
  append(observation: Observation): Observation;
  get(id: string): Observation | null;
  list(): readonly Observation[];
  listByTask(taskId: string): readonly Observation[];
  listByExecution(executionId: string): readonly Observation[];
  listByEffect(effectId: string): readonly Observation[];
}
