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
    });
    return await input.client.reportEffectResult(remote.id, "succeeded", note);
  } catch (error) {
    const note = error instanceof Error ? error.message : "EFFECT_EXECUTION_FAILED";
    return await input.client.reportEffectResult(remote.id, "failed", note.slice(0, 2_000));
  }
}
