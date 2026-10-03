import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type { ActorDescriptor, DispatchExecutionInput, DispatchReceipt, ExecutionProvider, PrepareExecutionInput, PreparedExecution, ProviderAvailability, ProviderExecutionRef, ProviderObservation, ProviderReconciliationResult, ProviderSignalsResult, ProviderMessage, SendReceipt } from "@agent-world/execution-providers";
import { decodeOrcaEnvelope, decodeOrcaStatus, decodeRunCreated, decodeWorkerStarted, decodeCompletedRequest, decodeInboxSignals, decodeReply } from "./decoder-v1.js";
import type { CliTransport } from "./cli-transport.js";
import { OrcaAttemptStore, type OrcaPlacement, type OrcaAttemptRecord, type OrcaReplyRecord } from "./attempt-store.js";
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
function requestIdentity(input: PrepareExecutionInput, operation: string): string {
  const digest = createHash("sha256").update(JSON.stringify([input.taskId, input.workUnitId, input.attemptId, input.dispatchFingerprint, operation])).digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
export interface OrcaProviderOptions {
  transport: CliTransport; store: OrcaAttemptStore; actors: ActorDescriptor[];
  /** Trusted host resolves only scoped context and authorized placement. */
  resolvePlacement(input: PrepareExecutionInput): Promise<OrcaPlacement>;
  /** Rechecked at prepare and immediately before claim/dispatch. */
  authorize(input: PrepareExecutionInput): Promise<boolean>;
  /** Host checks answer content and information flow, not only dispatch authority. */
  authorizeMessage?(input: PrepareExecutionInput, message: ProviderMessage): Promise<boolean>;
  now?: () => number;
}
export class OrcaExecutionProvider implements ExecutionProvider {
  readonly id = "orca";
  constructor(private options: OrcaProviderOptions) {
    if (options.actors.some(actor => actor.providerId !== this.id || !id(actor.id))) throw new Error("ORCA_ACTOR_SCOPE_MISMATCH");
  }
  async probe(): Promise<ProviderAvailability> {
    const result = await this.options.transport.call(["status", "--json"]);
    if (result.status !== "completed") return { status: "unavailable", reason: result.reason };
    if (result.exitCode !== 0) return { status: "unavailable", reason: "orca_cli_failed" };
    try { return decodeOrcaStatus(result.stdout); }
    catch { return { status: "unavailable", reason: "orca_malformed_response" }; }
  }
  async listActors(): Promise<ActorDescriptor[]> {
    if ((await this.probe()).status !== "available") return [];
    return structuredClone(this.options.actors);
  }
  async prepare(input: PrepareExecutionInput): Promise<PreparedExecution> {
    if (![input.taskId, input.workUnitId, input.attemptId, input.actorId, input.contextRef, input.authorizationRef, input.dispatchFingerprint].every(id) || !input.objective.trim() || input.objective.length > 10000 || !Array.isArray(input.resourceRefs) || !input.resourceRefs.every(id)) return { status: "rejected", reason: "invalid_execution_input" };
    if (!this.options.actors.some(actor => actor.id === input.actorId && actor.availability === "available")) return { status: "rejected", reason: "actor_unavailable" };
    if (!await this.options.authorize(input)) return { status: "rejected", reason: "policy_denied" };
    if ((await this.probe()).status !== "available") return { status: "rejected", reason: "provider_unavailable" };
    const placement = await this.options.resolvePlacement(input);
    if (!isAbsolute(placement.worktree) || !id(placement.agent) || !id(placement.coordinator) || typeof placement.spec !== "string" || !placement.spec.trim() || placement.spec.length > 30000 || placement.worktree.includes("\0")) return { status: "rejected", reason: "invalid_authorized_placement" };
    const handle = `aw2:${input.attemptId}`;
    try {
      this.options.store.create({ input: structuredClone(input), placement, handle,
        runRequestId: requestIdentity(input, "run-create"), workerRequestId: requestIdentity(input, "worker-start"), state: "prepared" });
    } catch { return { status: "rejected", reason: "attempt_identity_conflict" }; }
    return { status: "prepared", providerId: this.id, attemptId: input.attemptId, handle, dispatchFingerprint: input.dispatchFingerprint };
  }
  async dispatch(input: DispatchExecutionInput): Promise<DispatchReceipt> {
    const record = this.options.store.get(input.handle);
    if (!record || ["taskId", "workUnitId", "attemptId", "actorId", "dispatchFingerprint", "authorizationRef"].some(key => record.input[key as keyof PrepareExecutionInput] !== input[key as keyof DispatchExecutionInput])) return { status: "not-executed", reason: "prepared_scope_mismatch" };
    if (record.state === "dispatched" && record.receipt) return structuredClone(record.receipt);
    if (record.state !== "prepared") return { status: "unknown", reason: "reconciliation_required", ...(record.ref ? { ref: record.ref } : {}) };
    if (!await this.options.authorize(record.input)) return { status: "not-executed", reason: "policy_denied" };
    if ((await this.probe()).status !== "available") return { status: "not-executed", reason: "provider_unavailable" };
    if (!this.options.store.claim(record.handle)) return { status: "unknown", reason: "dispatch_already_claimed" };
    record.state = "dispatching";
    try {
      const run = await this.options.transport.call(this.runCommand(record));
      if (run.status !== "completed") throw new Error(run.status);
      record.runId = decodeRunCreated(run.stdout); this.options.store.save(record);
      const worker = await this.options.transport.call(this.workerCommand(record));
      if (worker.status !== "completed") throw new Error(worker.status);
      const decoded = decodeWorkerStarted(worker.stdout);
      record.ref = { provider: this.id, externalRunId: record.runId, externalTaskId: decoded.taskId, externalAttemptId: decoded.dispatchId,
        opaque: { attemptId: record.input.attemptId, runRequestId: record.runRequestId, workerRequestId: record.workerRequestId } };
      if (decoded.state !== "ready") throw new Error("incomplete_startup");
      const receipt: DispatchReceipt = { status: "dispatched", ref: record.ref, observedAt: (this.options.now ?? Date.now)() };
      record.state = "dispatched"; record.receipt = receipt; this.options.store.save(record); return receipt;
    } catch {
      record.state = "unknown"; this.options.store.save(record);
      return { status: "unknown", reason: "dispatch_unknown", ...(record.ref ? { ref: record.ref } : {}) };
    }
  }
  private runCommand(record: OrcaAttemptRecord): string[] {
    return ["orchestration", "run-create", "--objective", record.input.objective, "--from", record.placement.coordinator, "--retry-request", record.runRequestId, "--json"];
  }
  private workerCommand(record: OrcaAttemptRecord): string[] {
    if (!record.runId) throw new Error("ORCA_RUN_REQUIRED");
    const metadata = `\n\nAgent World OS metadata:\nGlobalTaskId: ${record.input.taskId}\nWorkUnitId: ${record.input.workUnitId}\nAttemptId: ${record.input.attemptId}\n`;
    return ["orchestration", "worker-start", "--spec", record.placement.spec + metadata, "--worktree", record.placement.worktree,
      "--agent", record.placement.agent, "--from", record.placement.coordinator, "--run", record.runId, "--retry-request", record.workerRequestId, "--json"];
  }
  /** Host-only receipt recovery: never starts a missing next operation. */
  async recoverDispatch(input: DispatchExecutionInput): Promise<DispatchReceipt> {
    const record = this.options.store.get(input.handle);
    if (!record || ["taskId", "workUnitId", "attemptId", "actorId", "dispatchFingerprint", "authorizationRef"].some(key => record.input[key as keyof PrepareExecutionInput] !== input[key as keyof DispatchExecutionInput])) return { status: "not-executed", reason: "prepared_scope_mismatch" };
    if (record.state === "dispatched" && record.receipt) return structuredClone(record.receipt);
    if (record.state === "prepared") return { status: "not-executed", reason: "attempt_not_dispatched" };
    const uncertain = (reason: string): DispatchReceipt => ({ status: "unknown", reason, ...(record.ref ? { ref: record.ref } : {}) });
    if (!await this.options.authorize(record.input)) return uncertain("recovery_policy_denied");
    if ((await this.probe()).status !== "available") return uncertain("provider_unavailable");
    const readCompleted = async (requestId: string, method: string): Promise<string | undefined> => {
      const lookup = await this.options.transport.call(["orchestration", "request-show", "--request", requestId, "--json"]);
      if (lookup.status !== "completed" || lookup.exitCode !== 0) return undefined;
      return decodeCompletedRequest(lookup.stdout, requestId, method);
    };
    try {
      if (!record.runId) {
        const run = await readCompleted(record.runRequestId, "orchestration.runCreate");
        if (!run) return uncertain("run_receipt_unresolved");
        record.runId = decodeRunCreated(run); this.options.store.save(record);
      }
      const worker = await readCompleted(record.workerRequestId, "orchestration.workerStart");
      if (!worker) return uncertain("worker_receipt_unresolved");
      const decoded = decodeWorkerStarted(worker);
      record.ref = { provider: this.id, externalRunId: record.runId, externalTaskId: decoded.taskId, externalAttemptId: decoded.dispatchId,
        opaque: { attemptId: record.input.attemptId, runRequestId: record.runRequestId, workerRequestId: record.workerRequestId } };
      if (decoded.state !== "ready") { record.state = "unknown"; this.options.store.save(record); return uncertain("incomplete_startup"); }
      const receipt: DispatchReceipt = { status: "dispatched", ref: record.ref, observedAt: (this.options.now ?? Date.now)() };
      record.state = "dispatched"; record.receipt = receipt; this.options.store.save(record); return receipt;
    } catch { return uncertain("receipt_recovery_unverifiable"); }
  }
  async observe(ref: ProviderExecutionRef): Promise<ProviderObservation> {
    const observedAt = (this.options.now ?? Date.now)();
    if (ref.provider !== this.id || !id(ref.externalAttemptId)) return { status: "unverifiable", observedAt, reason: "provider_reference_invalid" };
    const attemptId = ref.opaque?.attemptId;
    if (!id(attemptId)) return { status: "unverifiable", observedAt, reason: "provider_reference_unbound" };
    const record = this.options.store.get(`aw2:${attemptId}`);
    if (!record?.ref || record.ref.externalRunId !== ref.externalRunId || record.ref.externalTaskId !== ref.externalTaskId || record.ref.externalAttemptId !== ref.externalAttemptId) return { status: "unverifiable", observedAt, reason: "provider_reference_scope_mismatch" };
    const response = await this.options.transport.call(["orchestration", "worker-show", "--dispatch", ref.externalAttemptId, "--json"]);
    if (response.status !== "completed") return { status: response.status === "timeout" ? "timeout" : "unverifiable", observedAt, reason: response.reason };
    try {
      const value = decodeOrcaEnvelope(response.stdout);
      const dispatch = value.dispatch as Record<string, unknown>, worker = value.worker as Record<string, unknown>;
      if (!dispatch || !worker || dispatch.id !== ref.externalAttemptId || dispatch.taskId !== ref.externalTaskId || dispatch.runId !== ref.externalRunId) throw new Error("stale_dispatch");
      if (worker.state === "succeeded") return { status: "reported-success", observedAt };
      if (worker.state === "failed") return { status: "reported-failure", observedAt };
      if (worker.state === "outcome_unknown") return { status: "unknown", observedAt, reason: "orca_outcome_unknown" };
      // PTY liveness alone cannot prove a worker is running.
      const projection = value.projection as { dispatchId?: string; liveness?: { verdict?: string } } | undefined;
      if (projection?.dispatchId === ref.externalAttemptId) {
        if (projection.liveness?.verdict === "live" && ["ready", "running"].includes(String(worker.state))) return { status: "running", observedAt };
        if (projection.liveness?.verdict === "exited") return { status: "exited", observedAt };
      }
      return { status: "unverifiable", observedAt, reason: "worker_unverifiable" };
    } catch { return { status: "unverifiable", observedAt, reason: "orca_response_unverifiable" }; }
  }
  async reconcile(ref: ProviderExecutionRef, _previous: ProviderObservation): Promise<ProviderReconciliationResult> {
    const observation = await this.observe(ref);
    if (["unknown", "unverifiable", "timeout", "not-found"].includes(observation.status)) return { status: "unverifiable", reason: "reconciliation_required" };
    return { status: "observed", observation };
  }
  async receive(ref: ProviderExecutionRef): Promise<ProviderSignalsResult> {
    const attemptId = ref.opaque?.attemptId;
    if (ref.provider !== this.id || !id(attemptId)) return { status: "unverifiable", reason: "provider_reference_unbound" };
    const record = this.options.store.get(`aw2:${attemptId}`);
    if (!record?.ref || record.ref.externalRunId !== ref.externalRunId || record.ref.externalTaskId !== ref.externalTaskId || record.ref.externalAttemptId !== ref.externalAttemptId) return { status: "unverifiable", reason: "provider_reference_scope_mismatch" };
    const worker = await this.options.transport.call(["orchestration", "worker-show", "--dispatch", ref.externalAttemptId!, "--json"]);
    if (worker.status !== "completed" || worker.exitCode !== 0) return { status: "unverifiable", reason: "worker_identity_unverifiable" };
    try {
      const value = decodeOrcaEnvelope(worker.stdout), dispatch = value.dispatch as Record<string, unknown>;
      if (!dispatch || dispatch.id !== ref.externalAttemptId || dispatch.taskId !== ref.externalTaskId || dispatch.runId !== ref.externalRunId || !id(dispatch.assigneeHandle)) throw new Error("ORCA_DISPATCH_SCOPE_MISMATCH");
      const inbox = await this.options.transport.call(["orchestration", "inbox", "--terminal", `run:${ref.externalRunId}`, "--limit", "1000", "--full", "--json"]);
      if (inbox.status !== "completed") return { status: inbox.status === "timeout" ? "timeout" : "unverifiable", reason: inbox.reason };
      if (inbox.exitCode !== 0) return { status: "unverifiable", reason: "inbox_unavailable" };
      const signals = decodeInboxSignals(inbox.stdout, { runId: ref.externalRunId!, taskId: ref.externalTaskId!, dispatchId: ref.externalAttemptId!, assigneeHandle: dispatch.assigneeHandle, attemptId }, (this.options.now ?? Date.now)());
      // A mailbox report is evidence only. Never turn it into global success.
      this.options.store.rememberSignals(signals);
      return { status: "observed", signals: this.options.store.signals(attemptId) };
    } catch { return { status: "unverifiable", reason: "inbox_response_unverifiable" }; }
  }
  async send(ref: ProviderExecutionRef, message: ProviderMessage): Promise<SendReceipt> {
    const attemptId = ref.opaque?.attemptId;
    if (ref.provider !== this.id || !id(attemptId) || !id(message.id) || !id(message.inReplyTo) || typeof message.text !== "string" || !message.text.trim() || message.text.length > 30000) return { status: "rejected", reason: "invalid_reply" };
    const record = this.options.store.get(`aw2:${attemptId}`);
    if (!record?.ref || record.ref.externalRunId !== ref.externalRunId || record.ref.externalTaskId !== ref.externalTaskId || record.ref.externalAttemptId !== ref.externalAttemptId) return { status: "rejected", reason: "provider_reference_scope_mismatch" };
    const existing = this.options.store.reply(attemptId, message.inReplyTo);
    if (existing) {
      if (JSON.stringify(existing.message) !== JSON.stringify(message)) return { status: "rejected", reason: "reply_identity_conflict" };
      return existing.receipt ?? { status: "unknown", reason: "reply_reconciliation_required" };
    }
    if (!await this.options.authorize(record.input) || !this.options.authorizeMessage || !await this.options.authorizeMessage(record.input, message)) return { status: "rejected", reason: "reply_policy_denied" };
    const inbox = await this.receive(ref);
    if (inbox.status !== "observed" || !inbox.signals.some(signal => signal.id === message.inReplyTo && signal.type === "question")) return { status: "rejected", reason: "question_not_observed" };
    const observation = await this.observe(ref);
    if (observation.status !== "running") return { status: "rejected", reason: "question_worker_not_running" };
    if (!await this.options.authorize(record.input) || !await this.options.authorizeMessage(record.input, message)) return { status: "rejected", reason: "reply_policy_denied" };
    const reply: OrcaReplyRecord = { attemptId, message: structuredClone(message), requestId: requestIdentity(record.input, `reply:${message.inReplyTo}`), state: "sending" };
    if (!this.options.store.claimReply(reply)) return { status: "unknown", reason: "reply_already_claimed" };
    try {
      const response = await this.options.transport.call(["orchestration", "reply", "--id", message.inReplyTo, "--body", message.text, "--run", ref.externalRunId!, "--from", record.placement.coordinator, "--retry-request", reply.requestId, "--json"]);
      if (response.status !== "completed" || response.exitCode !== 0) throw new Error("ORCA_REPLY_UNKNOWN");
      reply.receipt = { status: "accepted", operationId: decodeReply(response.stdout, { runId: ref.externalRunId!, dispatchId: ref.externalAttemptId!, questionId: message.inReplyTo, body: message.text }) };
      reply.state = "accepted"; this.options.store.saveReply(reply); return reply.receipt;
    } catch { reply.state = "unknown"; this.options.store.saveReply(reply); return { status: "unknown", reason: "reply_unknown" }; }
  }
  /** Inspect a lost answer receipt without sending another answer. */
  async recoverSend(ref: ProviderExecutionRef, message: ProviderMessage): Promise<SendReceipt> {
    const attemptId = ref.opaque?.attemptId;
    if (ref.provider !== this.id || !id(attemptId) || !id(message.inReplyTo)) return { status: "rejected", reason: "invalid_reply" };
    const record = this.options.store.get(`aw2:${attemptId}`), reply = this.options.store.reply(attemptId, message.inReplyTo);
    if (!record?.ref || record.ref.externalRunId !== ref.externalRunId || record.ref.externalTaskId !== ref.externalTaskId || record.ref.externalAttemptId !== ref.externalAttemptId || !reply || JSON.stringify(reply.message) !== JSON.stringify(message)) return { status: "rejected", reason: "reply_scope_mismatch" };
    if (reply.receipt) return reply.receipt;
    try {
      const response = await this.options.transport.call(["orchestration", "request-show", "--request", reply.requestId, "--json"]);
      if (response.status !== "completed" || response.exitCode !== 0) throw new Error("ORCA_REPLY_UNVERIFIABLE");
      const receipt = decodeCompletedRequest(response.stdout, reply.requestId, "orchestration.reply");
      if (!receipt) return { status: "unknown", reason: "reply_receipt_unresolved" };
      reply.receipt = { status: "accepted", operationId: decodeReply(receipt, { runId: ref.externalRunId!, dispatchId: ref.externalAttemptId!, questionId: message.inReplyTo, body: message.text }) };
      reply.state = "accepted"; this.options.store.saveReply(reply); return reply.receipt;
    } catch { return { status: "unknown", reason: "reply_recovery_unverifiable" }; }
  }
}
