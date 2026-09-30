import type { EffectKind, PendingEffect } from "./effects.js";

export interface EffectExecutionContext {
  tenantId: string;
  requestedBy: string;
  confirmedBy: string;
  requestId?: string;
  timeoutMs?: number;
}

export interface EffectHandler {
  execute(effect: PendingEffect, context: EffectExecutionContext): Promise<string>;
}

export type EffectHandlers = Partial<Record<EffectKind, EffectHandler>>;

/**
 * Provider-neutral execution boundary. Providers receive only a confirmed,
 * tenant-scoped effect and return a bounded operator-facing note.
 */
export async function dispatchConfirmedEffect(
  effect: PendingEffect,
  handlers: EffectHandlers,
  context: EffectExecutionContext,
): Promise<string> {
  if (effect.status !== "confirmed") throw new Error("EFFECT_NOT_CONFIRMED");
  if (effect.tenantId !== context.tenantId || effect.tenantId.trim().length === 0) {
    throw new Error("EFFECT_TENANT_MISMATCH");
  }
  if (effect.requestedBy !== context.requestedBy || !context.requestedBy.trim()) {
    throw new Error("EFFECT_REQUESTOR_MISMATCH");
  }
  if (effect.confirmedBy !== context.confirmedBy || !context.confirmedBy.trim()) {
    throw new Error("EFFECT_CONFIRMATION_MISMATCH");
  }
  const handler = handlers[effect.kind];
  if (!handler) throw new Error(`EFFECT_HANDLER_NOT_CONFIGURED:${effect.kind}`);
  const timeoutMs = context.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new Error("INVALID_EFFECT_EXECUTION_TIMEOUT");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("EFFECT_EXECUTION_TIMEOUT")), timeoutMs);
  });
  const execution = handler.execute(structuredClone(effect), { ...context });
  const note = await Promise.race([execution, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
  if (typeof note !== "string" || note.trim().length < 3 || note.length > 2_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note)) {
    throw new Error("INVALID_EFFECT_EXECUTION_NOTE");
  }
  return note.trim();
}
