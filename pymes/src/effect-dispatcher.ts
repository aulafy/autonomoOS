import type { EffectKind, PendingEffect } from "./effects.js";

export interface EffectExecutionContext {
  tenantId: string;
  requestedBy: string;
  confirmedBy: string;
  requestId?: string;
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
  if (effect.confirmedBy !== context.confirmedBy || !context.confirmedBy.trim()) {
    throw new Error("EFFECT_CONFIRMATION_MISMATCH");
  }
  const handler = handlers[effect.kind];
  if (!handler) throw new Error(`EFFECT_HANDLER_NOT_CONFIGURED:${effect.kind}`);
  const note = await handler.execute(structuredClone(effect), { ...context });
  if (typeof note !== "string" || note.trim().length < 3 || note.length > 2_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note)) {
    throw new Error("INVALID_EFFECT_EXECUTION_NOTE");
  }
  return note.trim();
}
