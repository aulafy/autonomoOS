import type { DataFlowStore } from "./data-flow-store.js";
import type { InMemoryTaskWorkingSetStore } from "./working-set.js";
import type { SinkRegistry } from "./sink-registry.js";
import { releaseApprovalMatches, type InMemoryReleaseApprovalStore } from "./release-approvals.js";
import { FlowError, type FlowDecision, type FlowRequest, type FlowRule,
  type FlowVerdict } from "./types.js";

export class FlowEngine {
  constructor(private readonly objects: DataFlowStore,
    private readonly workingSets: InMemoryTaskWorkingSetStore,
    private readonly sinks: SinkRegistry,
    private readonly approvals: InMemoryReleaseApprovalStore,
    private readonly rules: readonly FlowRule[],
    private readonly now: () => number) {}

  evaluate(request: FlowRequest, approvalId?: string): FlowDecision {
    const at = this.now();
    const workingSet = this.workingSets.get(request.taskId);
    const deny = (reason: string): FlowDecision => ({ ...structuredClone(request),
      verdict: "deny", workingSetVersion: workingSet.version, evaluatedAt: at,
      ruleResults: [{ ruleId: "FAIL_CLOSED", verdict: "deny", reason }] });
    if (!request.taskId || !request.intentId || !Array.isArray(request.objectIds) ||
      !request.objectIds.length || new Set(request.objectIds).size !== request.objectIds.length) {
      return deny("INVALID_FLOW_REQUEST");
    }
    const sink = this.sinks.get(request.sinkId);
    if (!sink || sink.trust === "unknown") return deny("UNKNOWN_SINK");
    const objects = request.objectIds.map(id => this.objects.get(id));
    if (objects.some(object => !object || object.taskId !== request.taskId ||
      !workingSet.objectIds.includes(object.id))) return deny("UNKNOWN_DATA_OBJECT");
    if (objects.some(object => !object?.label)) return deny("UNKNOWN_DATA_LABEL");
    const concrete = objects.map(object => object!);
    const results = this.rules.map(rule => {
      const result = rule.evaluate(structuredClone(concrete), structuredClone(sink));
      if (result.ruleId !== rule.id || !["allow", "require_release_approval", "deny"]
        .includes(result.verdict) || !result.reason) throw new FlowError("INVALID_FLOW_RULE_RESULT");
      return structuredClone(result);
    });
    const verdict: FlowVerdict = results.some(result => result.verdict === "deny") ? "deny" :
      results.some(result => result.verdict === "require_release_approval")
        ? "require_release_approval" : "allow";
    const approval = approvalId ? this.approvals.get(approvalId) : null;
    const approved = verdict === "require_release_approval" && approval !== null &&
      releaseApprovalMatches(approval, request, workingSet.version, at);
    return { ...structuredClone(request), verdict: approved ? "allow" : verdict,
      workingSetVersion: workingSet.version, evaluatedAt: at, ruleResults: results,
      approvalId: approved ? approval!.id : undefined };
  }

  isCurrent(decision: FlowDecision): boolean {
    return decision.workingSetVersion === this.workingSets.get(decision.taskId).version;
  }
}
