import { requirePermission, type WorkspacePrincipal } from "./workspace-policy.js";

export type EffectKind = "call" | "calendar" | "message" | "crm_task";
const effectKinds: readonly EffectKind[] = ["call", "calendar", "message", "crm_task"];
export interface PendingEffect { id: string; tenantId: string; caseId: string; kind: EffectKind; payload: Record<string, unknown>; status: "pending" | "confirmed" | "succeeded" | "failed"; requestedBy: string; requestedAt: string; retryCount: number; confirmedBy?: string; confirmedAt?: string; executedBy?: string; executedAt?: string; executionNote?: string; draftHash: string; }
export function createPendingEffect(input: { id: string; tenantId: string; caseId: string; kind: EffectKind; payload: Record<string, unknown>; principal: WorkspacePrincipal; requestedAt: string; draftHash: string }): PendingEffect {
  requirePermission(input.principal, "executeEffect", { tenantId: input.tenantId, id: input.caseId });
  const payloadBytes = new TextEncoder().encode(JSON.stringify(input.payload)).byteLength;
  if (!effectKinds.includes(input.kind) || !input.id || input.id.length > 200 || !input.caseId || input.caseId.length > 200 || input.tenantId.length > 200 || !input.draftHash || input.draftHash.length > 500 || Number.isNaN(Date.parse(input.requestedAt)) || Object.keys(input.payload).length === 0 || payloadBytes > 65536) throw new Error("INVALID_PENDING_EFFECT");
  return { id: input.id, tenantId: input.tenantId, caseId: input.caseId, kind: input.kind, payload: structuredClone(input.payload), status: "pending", requestedBy: input.principal.userId, requestedAt: input.requestedAt, retryCount: 0, draftHash: input.draftHash };
}
