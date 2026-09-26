import type { DataFlowStore } from "./data-flow-store.js";
import { FlowError } from "./types.js";

export interface TaskWorkingSet {
  taskId: string;
  objectIds: string[];
  version: number;
}

export class InMemoryTaskWorkingSetStore {
  private readonly sets = new Map<string, TaskWorkingSet>();
  constructor(private readonly objects: DataFlowStore) {}

  get(taskId: string): TaskWorkingSet {
    return structuredClone(this.sets.get(taskId) ?? { taskId, objectIds: [], version: 0 });
  }
  add(taskId: string, objectId: string, expectedVersion: number): TaskWorkingSet {
    const current = this.get(taskId);
    if (current.version !== expectedVersion) throw new FlowError("WORKING_SET_VERSION_CONFLICT");
    const object = this.objects.get(objectId);
    if (!object || object.taskId !== taskId) throw new FlowError("DATA_OBJECT_NOT_IN_TASK");
    if (current.objectIds.includes(objectId)) return current;
    const next = { taskId, objectIds: [...current.objectIds, objectId], version: current.version + 1 };
    this.sets.set(taskId, structuredClone(next));
    return structuredClone(next);
  }
}
