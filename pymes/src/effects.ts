import { requirePermission, type WorkspacePrincipal } from "./workspace-policy.js";

export type EffectKind = "call" | "calendar" | "message" | "crm_task";
export const MAX_EFFECT_RETRIES = 20;
const effectKinds: readonly EffectKind[] = ["call", "calendar", "message", "crm_task"];
function safeResourceText(value: string, maxLength: number): boolean {
  return value.trim().length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}
function validPayloadForKind(kind: EffectKind, payload: Record<string, unknown>): boolean {
  if (kind === "message") return (payload.channel === "whatsapp" || payload.channel === "telegram" || payload.channel === "imessage" || payload.channel === "email") && typeof payload.text === "string" && safeResourceText(payload.text, 4_000);
  if (kind === "calendar") return typeof payload.title === "string" && safeResourceText(payload.title, 500) && typeof payload.startsAt === "string" && Number.isFinite(Date.parse(payload.startsAt));
  if (kind === "crm_task") return typeof payload.title === "string" && safeResourceText(payload.title, 500) && typeof payload.contactId === "string" && safeResourceText(payload.contactId, 200);
  return (typeof payload.objective === "string" && safeResourceText(payload.objective, 2_000) && Array.isArray(payload.questions) && payload.questions.length <= 100 && payload.questions.every(value => typeof value === "string" && safeResourceText(value, 500))) ||
    (typeof payload.phone === "string" && safeResourceText(payload.phone, 100));
}
export interface PendingEffect { id: string; tenantId: string; caseId: string; kind: EffectKind; payload: Record<string, unknown>; status: "pending" | "confirmed" | "succeeded" | "failed"; requestedBy: string; requestedAt: string; retryCount: number; confirmedBy?: string; confirmedAt?: string; executedBy?: string; executedAt?: string; executionNote?: string; draftHash: string; }
export function createPendingEffect(input: { id: string; tenantId: string; caseId: string; kind: EffectKind; payload: Record<string, unknown>; principal: WorkspacePrincipal; requestedAt: string; draftHash: string }): PendingEffect {
  requirePermission(input.principal, "executeEffect", { tenantId: input.tenantId, id: input.caseId });
  let payloadBytes = -1;
  try { payloadBytes = new TextEncoder().encode(JSON.stringify(input.payload)).byteLength; }
  catch { payloadBytes = -1; }
  if (!effectKinds.includes(input.kind) || !safeResourceText(input.id, 200) || !safeResourceText(input.caseId, 200) || !safeResourceText(input.tenantId, 200) || !safeResourceText(input.draftHash, 500) || Number.isNaN(Date.parse(input.requestedAt)) || !input.payload || typeof input.payload !== "object" || Array.isArray(input.payload) || Object.keys(input.payload).length === 0 || payloadBytes < 0 || payloadBytes > 65536 || !validPayloadForKind(input.kind, input.payload)) throw new Error("INVALID_PENDING_EFFECT");
  return { id: input.id, tenantId: input.tenantId, caseId: input.caseId, kind: input.kind, payload: structuredClone(input.payload), status: "pending", requestedBy: input.principal.userId, requestedAt: input.requestedAt, retryCount: 0, draftHash: input.draftHash };
}
