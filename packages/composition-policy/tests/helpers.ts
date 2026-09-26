import { InMemoryResourceRegistry, mintResourceId, type RegisterResourceInput } from "@agent-world/resources";
import { ActionRegistry, CandidateCompiler, CompositionEngine, defaultCompositionRules,
  InMemoryApprovalStore, InMemoryHistoryStore, type FactKind, type HistoryFact } from "../src/index.js";

export const fileId = mintResourceId("file", "workspace/confidential-report");
export const sinkId = mintResourceId("sink_email", "demo/outbound");
export const unknownSinkId = mintResourceId("sink_http", "demo/unknown");
export const toolId = mintResourceId("tool", "demo/code-runner");
export const walletId = mintResourceId("wallet", "demo/main");
export const robotId = mintResourceId("robot", "demo/arm");

export function fixture(maxHistoryAgeMs?: number) {
  let now = 100;
  const resources = new InMemoryResourceRegistry();
  for (const [id, kind, sink] of [
    [fileId, "file", null],
    [sinkId, "sink_email", { external: true, trustClass: "external", allowedSensitivity: ["public"] }],
    [unknownSinkId, "sink_http", null],
    [toolId, "tool", null], [walletId, "wallet", null], [robotId, "robot", null]
  ] as const) {
    resources.register({ id, kind, displayName: id, aliases: [], parentId: null,
      dataLabel: null, exclusivity: "shared", source: "host", sink } as RegisterResourceInput);
  }
  const actions = new ActionRegistry();
  for (const [actionType, actionClass] of [
    ["noop", "safe"], ["read", "sensitive_read"], ["send", "external_send"],
    ["publish", "public_publish"], ["access_credential", "credential_access"],
    ["run_untrusted", "untrusted_code_execution"], ["pay", "payment"],
    ["move_robot", "robot_action"]
  ] as const) actions.register({ actionType, actionClass });
  const history = new InMemoryHistoryStore();
  const approvals = new InMemoryApprovalStore();
  const compiler = new CandidateCompiler(actions, resources);
  const engine = new CompositionEngine(compiler, history, approvals,
    defaultCompositionRules(), { now: () => now }, maxHistoryAgeMs);
  const fact = (kind: FactKind, taskId = "task-1", occurredAt = 100): HistoryFact => ({
    id: `${taskId}:${kind}:${history.currentVersion(taskId) + 1}`, taskId, kind, occurredAt,
    source: "trusted_control_event", sourceId: `event-${history.currentVersion(taskId) + 1}`,
    resourceIds: [fileId], metadata: {}
  });
  const request = (actionType: string, taskId = "task-1", intentId = "intent-1",
    planId = "plan-1") => ({ taskId, intentId, planId, actionType,
      resourceIds: actionType === "send" || actionType === "publish" ? [sinkId] :
        actionType === "pay" ? [walletId] : actionType === "run_untrusted" ? [toolId] :
          actionType === "move_robot" ? [robotId] : [fileId],
      sinkId: actionType === "send" || actionType === "publish" ? sinkId : undefined
  });
  return { resources, actions, history, approvals, compiler, engine, fact, request,
    setNow: (value: number) => { now = value; } };
}
