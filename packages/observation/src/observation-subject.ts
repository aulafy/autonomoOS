import type { ResourceId } from "@agent-world/resources";

export interface ObservationSubject {
  taskId: string;
  intentId?: string;
  executionId?: string;
  effectId?: string;
  resourceIds: ResourceId[];
}

export function sameSubject(left: ObservationSubject, right: ObservationSubject): boolean {
  if (!left || !right || !Array.isArray(left.resourceIds) || !Array.isArray(right.resourceIds)) return false;
  const leftIds = [...left.resourceIds].sort();
  const rightIds = [...right.resourceIds].sort();
  return left.taskId === right.taskId && left.intentId === right.intentId &&
    left.executionId === right.executionId && left.effectId === right.effectId &&
    leftIds.length === rightIds.length && leftIds.every((id, index) => id === rightIds[index]);
}
