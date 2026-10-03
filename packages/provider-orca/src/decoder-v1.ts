import type { ProviderAvailability, ProviderSignal } from "@agent-world/execution-providers";
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ORCA_MALFORMED_RESPONSE");
  return value as Record<string, unknown>;
};
/** Public CLI envelope observed in the installed 2026 Orca distribution. */
export function decodeOrcaEnvelope(text: string): Record<string, unknown> {
  const envelope = object(JSON.parse(text));
  if (envelope.ok !== true) throw new Error("ORCA_RPC_NOT_SUCCESSFUL");
  return object(envelope.result);
}
export function decodeOrcaStatus(text: string): ProviderAvailability {
  const value = decodeOrcaEnvelope(text), runtime = object(value.runtime), target = object(value.target);
  if (target.kind !== "local") return { status: "unavailable", reason: "orca_local_target_required" };
  if (typeof runtime.reachable !== "boolean" || typeof runtime.state !== "string") throw new Error("ORCA_MALFORMED_RESPONSE");
  if (!runtime.reachable) return { status: "unavailable", reason: "orca_runtime_not_reachable" };
  const capabilities = runtime.capabilities;
  if (!Array.isArray(capabilities) || capabilities.some(value => typeof value !== "string" || !value.trim()) || new Set(capabilities).size !== capabilities.length) throw new Error("ORCA_MALFORMED_RESPONSE");
  if (runtime.state !== "ready") return { status: "degraded", reason: "orca_runtime_not_ready", capabilities };
  if (!capabilities.includes("orchestration.contract.v1")) return { status: "unavailable", reason: "orca_supervised_contract_missing" };
  if (runtime.appVersion !== undefined && (typeof runtime.appVersion !== "string" || !runtime.appVersion)) throw new Error("ORCA_MALFORMED_RESPONSE");
  return { status: "available", capabilities, ...(runtime.appVersion ? { version: runtime.appVersion as string } : {}) };
}

export function decodeRunCreated(text: string): string {
  const result = decodeOrcaEnvelope(text), run = object(result.run);
  if (typeof run.id !== "string" || !run.id || run.id.length > 200) throw new Error("ORCA_MALFORMED_RESPONSE");
  return run.id;
}
export function decodeWorkerStarted(text: string): { dispatchId: string; taskId: string; state: string } {
  const result = decodeOrcaEnvelope(text);
  for (const key of ["dispatchId", "taskId", "state"]) if (typeof result[key] !== "string" || !result[key] || (result[key] as string).length > 200) throw new Error("ORCA_MALFORMED_RESPONSE");
  return { dispatchId: result.dispatchId as string, taskId: result.taskId as string, state: result.state as string };
}
export function decodeRequestState(text: string, requestId: string, method: string): "completed" | "pending" | "absent" {
  const value = decodeOrcaEnvelope(text);
  if (value.requestId !== requestId || !["completed", "pending", "absent"].includes(String(value.state))) throw new Error("ORCA_REQUEST_SCOPE_MISMATCH");
  if (value.state !== "absent" && value.method !== method) throw new Error("ORCA_REQUEST_METHOD_MISMATCH");
  return value.state as "completed" | "pending" | "absent";
}
/** request-show exposes its recorded result; recovery can remain read-only. */
export function decodeCompletedRequest(text: string, requestId: string, method: string): string | undefined {
  if (decodeRequestState(text, requestId, method) !== "completed") return undefined;
  const receipt = object(decodeOrcaEnvelope(text).receipt), mutation = object(receipt.mutation);
  if (mutation.requestId !== requestId) throw new Error("ORCA_RECEIPT_SCOPE_MISMATCH");
  return JSON.stringify({ ok: true, result: receipt });
}
export function decodeInboxSignals(text: string, scope: { runId: string; taskId: string; dispatchId: string; assigneeHandle: string; attemptId: string }, observedAt: number): ProviderSignal[] {
  const value = decodeOrcaEnvelope(text);
  if (!Array.isArray(value.messages) || value.messages.length > 1000) throw new Error("ORCA_MALFORMED_INBOX");
  const signals: ProviderSignal[] = [];
  for (const raw of value.messages) {
    const message = object(raw);
    if (message.delivery_contract !== undefined && message.delivery_contract !== "current_delivery") continue;
    if (message.run_id !== scope.runId || message.to_handle !== `run:${scope.runId}` || !["worker_done", "question", "escalation"].includes(String(message.type))) continue;
    const payload = object(typeof message.payload === "string" ? JSON.parse(message.payload) : message.payload);
    if (payload.dispatchId !== scope.dispatchId || (payload.taskId !== undefined && payload.taskId !== scope.taskId)) continue;
    if (![scope.assigneeHandle, `dispatch:${scope.dispatchId}`].includes(String(message.from_handle))) continue;
    if (typeof message.id !== "string" || !message.id || message.id.length > 200 || typeof message.body !== "string" || message.body.length > 30000) throw new Error("ORCA_MALFORMED_MESSAGE");
    let type: ProviderSignal["type"];
    if (message.type === "worker_done") {
      if (payload.taskId !== scope.taskId || !["succeeded", "failed"].includes(String(payload.outcome))) throw new Error("ORCA_MALFORMED_COMPLETION");
      type = payload.outcome === "succeeded" ? "reported-success" : "reported-failure";
    } else type = message.type as "question" | "escalation";
    if (payload.options !== undefined && (!Array.isArray(payload.options) || payload.options.length > 50 || payload.options.some(option => typeof option !== "string" || option.length > 1000))) throw new Error("ORCA_MALFORMED_QUESTION");
    signals.push({ id: message.id, attemptId: scope.attemptId, observedAt, type, text: message.body,
      ...(type === "question" && payload.options ? { options: payload.options as string[] } : {}) });
  }
  return signals;
}
export function decodeReply(text: string, scope: { runId: string; dispatchId: string; questionId: string; body: string }): string {
  const message = object(decodeOrcaEnvelope(text).message);
  if (typeof message.id !== "string" || !message.id || message.id.length > 200 || message.run_id !== scope.runId || message.to_handle !== `dispatch:${scope.dispatchId}` || message.thread_id !== scope.questionId || message.body !== scope.body) throw new Error("ORCA_REPLY_SCOPE_MISMATCH");
  return message.id;
}
