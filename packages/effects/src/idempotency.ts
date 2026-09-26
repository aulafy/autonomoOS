import { createHash } from "node:crypto";
import { isCanonicalResourceId, type ResourceId } from "@agent-world/resources";
import { stableJson } from "./stable-json.js";

export interface SemanticEffectInput {
  taskId: string;
  intentId: string;
  action: string;
  resourceIds: ResourceId[];
  parameters: unknown;
  executorId: string;
}

export function effectIdempotencyKey(input: SemanticEffectInput): string {
  if (!input.taskId || !input.intentId || !input.action || !input.executorId ||
    !Array.isArray(input.resourceIds) ||
    input.resourceIds.some(id => !isCanonicalResourceId(id)) ||
    new Set(input.resourceIds).size !== input.resourceIds.length) {
    throw new Error("INVALID_SEMANTIC_EFFECT");
  }
  const canonical = stableJson({ taskId: input.taskId, intentId: input.intentId,
    action: input.action, resourceIds: [...input.resourceIds].sort(),
    parameters: input.parameters, executorId: input.executorId });
  return createHash("sha256").update(canonical).digest("hex");
}
