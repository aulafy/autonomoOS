export type DurableTaskStatus = "running" | "paused" | "cancelled" | "completed";
export interface DurableTaskRecord {
  id: string;
  principalId: string;
  status: DurableTaskStatus;
  requiredEffectIds: string[];
  createdAt: number;
  version: number;
}

export class InMemoryDurableTaskStore {
  private readonly tasks = new Map<string, DurableTaskRecord>();
  create(input: Omit<DurableTaskRecord, "version" | "requiredEffectIds" | "status">): DurableTaskRecord {
    if (!input.id || !input.principalId || !Number.isFinite(input.createdAt) ||
      this.tasks.has(input.id)) throw new Error("INVALID_TASK_CREATE");
    const task: DurableTaskRecord = { ...input, version: 1, status: "running",
      requiredEffectIds: [] };
    this.tasks.set(task.id, task);
    return structuredClone(task);
  }
  get(id: string): DurableTaskRecord | null {
    const value = this.tasks.get(id);
    return value ? structuredClone(value) : null;
  }
  list(): DurableTaskRecord[] {
    return [...this.tasks.values()].map(value => structuredClone(value));
  }
  addRequiredEffect(taskId: string, effectId: string,
    expectedVersion: number): DurableTaskRecord {
    const current = this.require(taskId, expectedVersion);
    if (current.status !== "running" || !effectId ||
      current.requiredEffectIds.includes(effectId)) throw new Error("INVALID_REQUIRED_EFFECT");
    const next = { ...current, requiredEffectIds: [...current.requiredEffectIds, effectId],
      version: current.version + 1 };
    this.tasks.set(taskId, next);
    return structuredClone(next);
  }
  setStatus(taskId: string, status: DurableTaskStatus,
    expectedVersion: number): DurableTaskRecord {
    const current = this.require(taskId, expectedVersion);
    if (!(["running", "paused", "cancelled", "completed"] as const).includes(status) ||
      current.status === "completed" || current.status === "cancelled" ||
      (status === "completed" && current.status !== "running")) {
      throw new Error("INVALID_TASK_TRANSITION");
    }
    const next = { ...current, status, version: current.version + 1 };
    this.tasks.set(taskId, next);
    return structuredClone(next);
  }
  isRunnable(taskId: string): boolean { return this.tasks.get(taskId)?.status === "running"; }
  private require(id: string, version: number): DurableTaskRecord {
    const task = this.tasks.get(id);
    if (!task || task.version !== version) throw new Error("TASK_VERSION_CONFLICT");
    return task;
  }
}
