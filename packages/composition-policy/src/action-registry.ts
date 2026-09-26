import { isCanonicalResourceId, type ResourceRegistry } from "@agent-world/resources";
import { CompositionError, type ActionDescriptor, type CandidateRequest,
  type CompositionCandidate, type SinkTrust } from "./types.js";

export class ActionRegistry {
  private readonly descriptors = new Map<string, ActionDescriptor>();
  register(descriptor: ActionDescriptor): void {
    if (!descriptor?.actionType || !["safe", "sensitive_read", "external_send", "public_publish",
      "credential_access", "untrusted_code_execution", "payment", "robot_action"]
      .includes(descriptor.actionClass) || this.descriptors.has(descriptor.actionType)) {
      throw new CompositionError("INVALID_ACTION_DESCRIPTOR");
    }
    this.descriptors.set(descriptor.actionType, structuredClone(descriptor));
  }
  get(actionType: string): ActionDescriptor | null {
    const descriptor = this.descriptors.get(actionType);
    return descriptor ? structuredClone(descriptor) : null;
  }
}

export class CandidateCompiler {
  constructor(private readonly actions: ActionRegistry,
    private readonly resources: ResourceRegistry) {}

  compile(request: CandidateRequest): CompositionCandidate {
    const descriptor = this.actions.get(request.actionType);
    if (!request.taskId || !request.intentId || !descriptor ||
      !Array.isArray(request.resourceIds) ||
      request.resourceIds.some(id => !isCanonicalResourceId(id) || !this.resources.has(id)) ||
      new Set(request.resourceIds).size !== request.resourceIds.length ||
      (request.sinkId !== undefined &&
        (!request.resourceIds.includes(request.sinkId) || !isCanonicalResourceId(request.sinkId)))) {
      throw new CompositionError("INVALID_COMPOSITION_CANDIDATE");
    }
    let sinkTrust: SinkTrust | undefined;
    if (request.sinkId) {
      const sink = this.resources.get(request.sinkId);
      sinkTrust = sink?.sink?.trustClass ?? "unknown";
    }
    if (["external_send", "public_publish"].includes(descriptor.actionClass) && !request.sinkId) {
      sinkTrust = "unknown";
    }
    return { taskId: request.taskId, intentId: request.intentId, planId: request.planId,
      actionType: descriptor.actionType, actionClass: descriptor.actionClass,
      resourceIds: [...request.resourceIds], sinkId: request.sinkId, sinkTrust };
  }
}
