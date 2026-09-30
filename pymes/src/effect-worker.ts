import { dispatchConfirmedEffect, type EffectHandlers } from "./effect-dispatcher.js";
import type { PendingEffect } from "./effects.js";
import type { RemoteEffect, WorkspaceClient } from "./workspace-client.js";

function asPending(effect: RemoteEffect): PendingEffect {
  return { ...effect, retryCount: effect.retryCount ?? 0, draftHash: effect.draftHash ?? "remote-draft" } as unknown as PendingEffect;
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
