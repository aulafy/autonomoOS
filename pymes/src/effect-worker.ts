import { dispatchConfirmedEffect, type EffectHandlers } from "./effect-dispatcher.js";
import type { PendingEffect } from "./effects.js";
import type { RemoteEffect, WorkspaceClient } from "./workspace-client.js";

function asPending(effect: RemoteEffect): PendingEffect {
  return { ...effect, retryCount: effect.retryCount ?? 0, draftHash: effect.draftHash ?? "remote-draft" } as unknown as PendingEffect;
}

function waitForWorkerDelay(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) finish();
  });
}

/** Executes one remote confirmed effect and records the provider outcome. */
export async function executeRemoteEffect(input: {
  client: WorkspaceClient;
  effectId: string;
  handlers: EffectHandlers;
  requestId?: string;
  timeoutMs?: number;
}): Promise<RemoteEffect> {
  const remote = await input.client.effect(input.effectId);
  if (remote.status !== "confirmed") throw new Error("EFFECT_NOT_CONFIRMED");
  try {
    const note = await dispatchConfirmedEffect(asPending(remote), input.handlers, {
      tenantId: remote.tenantId,
      requestedBy: remote.requestedBy,
      confirmedBy: remote.confirmedBy ?? "",
      requestId: input.requestId,
      timeoutMs: input.timeoutMs,
      idempotencyKey: remote.id,
    });
    return await input.client.reportEffectResult(remote.id, "succeeded", note);
  } catch (error) {
    const note = error instanceof Error ? error.message : "EFFECT_EXECUTION_FAILED";
    return await input.client.reportEffectResult(remote.id, "failed", note.slice(0, 2_000));
  }
}

export interface EffectBatchResult {
  effectId: string;
  status: "succeeded" | "failed" | "skipped";
  error?: string;
}

export interface EffectBatchSummary {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

function validWorkerBatch(results: unknown): results is EffectBatchResult[] {
  if (!Array.isArray(results) || results.length > 100) return false;
  const ids = new Set<string>();
  for (const result of results) {
    if (!result || typeof result !== "object") return false;
    const candidate = result as Partial<EffectBatchResult>;
    if (typeof candidate.effectId !== "string" || !candidate.effectId.trim() || ids.has(candidate.effectId)) return false;
    if (candidate.status !== "succeeded" && candidate.status !== "failed" && candidate.status !== "skipped") return false;
    ids.add(candidate.effectId);
  }
  return true;
}

/** Produces safe operational counters; it deliberately omits effect payloads and errors. */
export function summarizeEffectBatch(results: readonly EffectBatchResult[]): EffectBatchSummary {
  return results.reduce<EffectBatchSummary>((summary, result) => {
    summary.total += 1;
    if (result.status === "succeeded") summary.succeeded += 1;
    else if (result.status === "failed") summary.failed += 1;
    else summary.skipped += 1;
    return summary;
  }, { total: 0, succeeded: 0, failed: 0, skipped: 0 });
}

export async function executeConfirmedEffects(input: {
  client: WorkspaceClient;
  handlers: EffectHandlers;
  requestId?: string;
  timeoutMs?: number;
  limit?: number;
}): Promise<EffectBatchResult[]> {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("INVALID_EFFECT_BATCH_LIMIT");
  const effects = (await input.client.confirmedEffects()).slice(0, limit);
  const results: EffectBatchResult[] = [];
  for (const effect of effects) {
    try {
      const result = await executeRemoteEffect({ ...input, effectId: effect.id });
      results.push({ effectId: effect.id, status: result.status === "succeeded" ? "succeeded" : "failed" });
    } catch (error) {
      results.push({ effectId: effect.id, status: "skipped", error: error instanceof Error ? error.message : "EFFECT_BATCH_ITEM_FAILED" });
    }
  }
  return results;
}

export interface EffectWorkerLoopOptions {
  poll: () => Promise<EffectBatchResult[]>;
  intervalMs?: number;
  /** Test and graceful-shutdown hook; production callers leave it undefined. */
  signal?: AbortSignal;
  onCycle?: (results: EffectBatchResult[]) => void | Promise<void>;
  onSummary?: (summary: EffectBatchSummary) => void | Promise<void>;
  /** If supplied, transient poll errors are reported and retried after a bounded delay. */
  onError?: (error: unknown) => void | Promise<void>;
  retryDelayMs?: number;
  /** Optional finite run for cron/Kubernetes Jobs; omitted means resident mode. */
  maxCycles?: number;
}

/**
 * Runs the bounded worker poll cycle until it is aborted. The loop never
 * overlaps polls, and an individual poll failure is surfaced to the caller so
 * a supervisor can restart the process instead of silently losing work.
 */
export async function runEffectWorker(input: EffectWorkerLoopOptions): Promise<void> {
  const intervalMs = input.intervalMs ?? 5_000;
  if (!Number.isInteger(intervalMs) || intervalMs < 250 || intervalMs > 300_000) {
    throw new Error("INVALID_EFFECT_WORKER_INTERVAL");
  }
  const retryDelayMs = input.retryDelayMs ?? Math.min(intervalMs, 30_000);
  if (!Number.isInteger(retryDelayMs) || retryDelayMs < 250 || retryDelayMs > 300_000) {
    throw new Error("INVALID_EFFECT_WORKER_RETRY_DELAY");
  }
  if (input.maxCycles !== undefined && (!Number.isInteger(input.maxCycles) || input.maxCycles < 1 || input.maxCycles > 10_000)) {
    throw new Error("INVALID_EFFECT_WORKER_MAX_CYCLES");
  }
  const signal = input.signal;
  let cycles = 0;
  while (!signal?.aborted) {
    let results: EffectBatchResult[];
    try {
      results = await input.poll();
      if (!validWorkerBatch(results)) {
        throw new Error("INVALID_EFFECT_WORKER_RESULTS");
      }
    } catch (error) {
      if (!input.onError) throw error;
      await input.onError(error);
      if (signal?.aborted) break;
      await waitForWorkerDelay(retryDelayMs, signal);
      continue;
    }
    await input.onCycle?.(results);
    await input.onSummary?.(summarizeEffectBatch(results));
    cycles += 1;
    if (input.maxCycles !== undefined && cycles >= input.maxCycles) break;
    if (signal?.aborted) break;
    await waitForWorkerDelay(intervalMs, signal);
  }
}
