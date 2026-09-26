import { SupervisorEngine, type RuntimeSnapshot } from "../src/index.js";

export const thresholds = { stalledTaskMs: 10, preparingMs: 10, dispatchingMs: 10,
  maxUnknownBacklog: 1, highUnknownRate: 0.5 };
export function engine() { return new SupervisorEngine(thresholds); }
export function snapshot(): RuntimeSnapshot {
  return { now: 100, tasks: [], authorityLeases: [], resourceLeases: [], budgets: [],
    effects: [], reconciliations: [], components: [], quarantines: [],
    emergencyStop: { active: false }, policyAvailable: true, eventStoreAvailable: true,
    unknownRateByExecutor: {} };
}
export const effect = (status: RuntimeSnapshot["effects"][number]["status"]) => ({
  id: "effect-1", taskId: "task-1", executorId: "executor-1", status,
  createdAt: 80, dispatchStartedAt: 80, observationIds: [] as string[], required: true
});
