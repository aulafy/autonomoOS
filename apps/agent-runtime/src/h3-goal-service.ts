import { createHash, randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { type InferenceProvider, parseStructuredPlan } from "@agent-world/inference";
import type { DataLabel } from "@agent-world/information-flow";
import { type ActionIntent, type RuntimeEvent } from "@agent-world/protocol";
import { ResourceResolver, type ResourceRegistry } from "@agent-world/resources";
import { expectedBytes } from "@agent-world/filesystem";
import { createDemoControlPlane } from "./demo-control-plane.js";

type Control = ReturnType<typeof createDemoControlPlane>;
type Emitter = (event: RuntimeEvent) => void;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const secretLabel: DataLabel = { confidentiality: "secret", categories: [],
  jurisdictions: [], ownerPrincipalIds: [], releasable: false, metadata: {} };

export interface H3GoalInput {
  goal: string;
  /** Selected by the host from its registered files, never by the model. */
  targetId: string;
  principalId: string;
  expectedContent: string;
  signal?: AbortSignal;
}
export interface H3GoalResult {
  ok: boolean;
  taskId: string;
  planId: string;
  intentId?: string;
  effectId?: string;
  status: "completed" | "denied" | "planning_failed" | "failed";
  reason?: string;
  observationIds: string[];
  model?: string;
  latencyMs?: number;
  controlLatencyMs?: number;
  totalLatencyMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number };
  plan?: Array<{ action: string; targetId: string | null; parametersHash: string }>;
  acceptanceConfirmed?: boolean;
}

/** One narrow host-owned path from an untrusted local proposal to C11. */
export class H3GoalService {
  constructor(private readonly dependencies: { provider: InferenceProvider;
    control: Control; resources: ResourceRegistry; emit: Emitter;
    allowedTargetIds: readonly string[]; actorId: string;
    afterTaskPrepared?: (taskId: string) => void | Promise<void> }) {}

  async submitGoal(input: H3GoalInput): Promise<H3GoalResult> {
    const started = performance.now();
    const { provider, control, resources, emit, actorId } = this.dependencies;
    const taskId = randomUUID();
    const planId = randomUUID();
    const requestId = randomUUID();
    let planSummary: H3GoalResult["plan"];
    const base = { taskId, planId, observationIds: [] as string[] };
    const event = (type: RuntimeEvent["type"], payload: Record<string, unknown>,
      intentId?: string) => emit({ id: randomUUID(), timestamp: Date.now(), type,
        taskId, planId, correlationId: taskId, actorId, intentId, payload });
    const deny = (status: H3GoalResult["status"], reason: string): H3GoalResult => {
      control.pauseGoalTask(taskId);
      event(status === "planning_failed" ? "inference.failed" : "policy.denied",
        { reason, requestId, provider: provider.id });
      event("task.failed", { reason });
      return { ...base, ok: false, status, reason, plan: planSummary,
        acceptanceConfirmed: false,
        totalLatencyMs: Math.round(performance.now() - started) };
    };
    if (input.principalId !== actorId || !input.goal.trim() ||
      input.goal.length > 8192 || typeof input.targetId !== "string" ||
      typeof input.expectedContent !== "string" ||
      Buffer.byteLength(input.expectedContent, "utf8") > 1048576) {
      return deny("denied", "INVALID_GOAL_REQUEST");
    }
    const resolved = new ResourceResolver(resources).resolve(input.targetId,
      { expectedKinds: ["file"] });
    if (!resolved.ok) return deny("denied", `RESOURCE_${resolved.reason}`);
    const target = resolved.resource;
    if (!this.dependencies.allowedTargetIds.includes(target.id)) {
      return deny("denied", "TARGET_NOT_HOST_ALLOWED");
    }
    const expectedSha256 = hash(input.expectedContent);
    try {
      await control.prepareGoalTask({ taskId, principalId: input.principalId,
        targetId: target.id, action: "file.write", objective: "Governed local file write",
        expectedSha256 });
      await this.dependencies.afterTaskPrepared?.(taskId);
    } catch (error) {
      return deny("denied", error instanceof Error ? error.message : String(error));
    }
    event("task.created", { goalHash: hash(input.goal), targetId: target.id });
    // Human goal is conservatively classified as secret; C9 must permit the
    // local model sink before any prompt bytes leave this process.
    let goalObjectId: string;
    try {
      goalObjectId = await control.stageTrustedContent(taskId, actorId,
        input.goal, secretLabel);
      if (!control.authorizeInference(taskId, goalObjectId)) {
        return deny("denied", "INFERENCE_FLOW_DENIED");
      }
    } catch (error) {
      return deny("denied", error instanceof Error ? error.message : String(error));
    }
    const context = { agentId: actorId, userGoal: input.goal,
      availableActions: ["file.write"],
      entities: [{ id: target.id, kind: "file", name: target.displayName,
        affordances: ["file.write"] }],
      constraints: ["Only one file.write action for the listed resource."] };
    const promptHash = hash(JSON.stringify(context));
    let proposal: Awaited<ReturnType<InferenceProvider["proposePlan"]>> | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      let reservationId: string | undefined;
      event("inference.requested", { requestId, provider: provider.id, attempt,
        promptHash, targetId: target.id });
      try {
        const health = await provider.health();
        if (!health.ok) return deny("planning_failed",
          `INFERENCE_${health.reason ?? "UNAVAILABLE"}`.toUpperCase());
        reservationId = control.reserveInference(taskId, actorId, requestId, attempt);
        proposal = await provider.proposePlan(context, { signal: input.signal });
        proposal.plan = parseStructuredPlan(proposal.rawText);
        control.settleInference(reservationId, actorId, taskId, proposal.usage);
        event("inference.completed", { requestId, provider: provider.id,
          model: proposal.model ?? null, latencyMs: proposal.latencyMs,
          promptHash, responseHash: hash(proposal.rawText),
          usage: proposal.usage ?? null });
        break;
      } catch (error) {
        if (reservationId) control.settleInference(reservationId, actorId, taskId);
        const formatError = error instanceof SyntaxError || error instanceof ZodError ||
          (error instanceof Error && error.message === "MALFORMED_INFERENCE_RESPONSE");
        event("inference.failed", { requestId, provider: provider.id, attempt,
          reason: formatError ? "INVALID_STRUCTURED_OUTPUT" :
            error instanceof Error ? error.message : "INFERENCE_ERROR" });
        if (!formatError || attempt === 2) return deny("planning_failed",
          formatError ? "INVALID_STRUCTURED_OUTPUT" :
            error instanceof Error ? error.message : "INFERENCE_ERROR");
      }
    }
    if (!proposal) return deny("planning_failed", "NO_PROPOSAL");
    const responseHash = hash(proposal.rawText);
    planSummary = proposal.plan.actions.map(action => ({ action: action.action,
        targetId: action.targetId ?? null,
        parametersHash: hash(JSON.stringify(action.parameters ?? {})) }));
    event("plan.proposed", { requestId, provider: provider.id,
      model: proposal.model ?? null, responseHash, actions: planSummary });
    // H3 executes a single action only. No model-supplied identity, grants,
    // capability, approval, or arbitrary parameters survive compilation.
    if (proposal.plan.actions.length !== 1) return deny("denied", "PLAN_ACTION_COUNT");
    const action = proposal.plan.actions[0]!;
    if (action.action !== "file.write") return deny("denied", "ACTION_NOT_EXPOSED");
    const actionTarget = action.targetId ? new ResourceResolver(resources).resolve(
      action.targetId, { expectedKinds: ["file"] }) : null;
    if (!actionTarget?.ok || actionTarget.resource.id !== target.id) {
      return deny("denied", "PROPOSAL_TARGET_OUT_OF_SCOPE");
    }
    const params = action.parameters;
    if (!params || Object.keys(params).sort().join(",") !== "content,mode" ||
      typeof params.content !== "string" ||
      (params.mode !== "create" && params.mode !== "replace")) {
      return deny("denied", "INVALID_WRITE_PARAMETERS");
    }
    let contentHash: string;
    try { contentHash = expectedBytes(params).sha256; }
    catch { return deny("denied", "INVALID_WRITE_PARAMETERS"); }
    if (expectedSha256 !== contentHash) {
      return deny("denied", "EXPECTED_CONTENT_MISMATCH");
    }
    const intent: ActionIntent = { id: randomUUID(), actorId, action: "file.write",
      targetId: String(target.metadata.relativePath),
      parameters: { content: params.content, mode: params.mode },
      provenance: { source: "model", sourceId: planId, taskId, provider: provider.id,
        model: proposal.model, inferenceRequestId: requestId,
        promptHash, responseHash } };
    event("plan.accepted", { requestId, actionCount: 1 });
    event("action.proposed", { action: intent.action, targetId: target.id,
      parametersHash: hash(JSON.stringify(intent.parameters)), provenance: intent.provenance },
    intent.id);
    let objectId: string;
    try {
      objectId = await control.stageTrustedContent(taskId, actorId,
        params.content, secretLabel);
    } catch (error) {
      return deny("failed", error instanceof Error ? error.message : String(error));
    }
    let result: Awaited<ReturnType<Control["run"]>>;
    const controlStarted = performance.now();
    try {
      result = await control.run(intent, taskId, taskId, planId, input.signal,
        { flowObjectIds: [objectId] });
    } catch (error) {
      return deny("failed", error instanceof Error ? error.message : String(error));
    }
    const controlLatencyMs = Math.round(performance.now() - controlStarted);
    if (result.status !== "completed") {
      return { ...deny(result.status === "denied" ? "denied" : "failed",
        result.reasonCode ?? result.status), intentId: intent.id,
        effectId: result.effectId, observationIds: result.observationIds,
        model: proposal.model, latencyMs: proposal.latencyMs, usage: proposal.usage,
        controlLatencyMs };
    }
    if (!(await control.mayComplete(taskId))) return deny("failed", "ACCEPTANCE_NOT_CONFIRMED");
    event("observation.confirmed", { effectId: result.effectId,
      observationIds: result.observationIds }, intent.id);
    event("task.completed", { effectId: result.effectId, accepted: true }, intent.id);
    return { ...base, ok: true, status: "completed", intentId: intent.id,
      effectId: result.effectId, observationIds: result.observationIds,
      model: proposal.model, latencyMs: proposal.latencyMs, usage: proposal.usage,
      plan: planSummary, acceptanceConfirmed: true, controlLatencyMs,
      totalLatencyMs: Math.round(performance.now() - started) };
  }
}
