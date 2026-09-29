import { requirePermission, type WorkspacePrincipal } from "./workspace-policy.js";

export type EffectKind = "call" | "calendar" | "message" | "crm_task";
export interface PendingEffect { id: string; tenantId: string; caseId: string; kind: EffectKind; payload: Record<string, unknown>; status: "pending" | "confirmed"; requestedBy: string; requestedAt: string; confirmedBy?: string; confirmedAt?: string; draftHash: string; }
export function createPendingEffect(input: { id: string; tenantId: string; caseId: string; kind: EffectKind; payload: Record<string, unknown>; principal: WorkspacePrincipal; requestedAt: string; draftHash: string }): PendingEffect {
  requirePermission(input.principal, "executeEffect", { tenantId: input.tenantId, id: input.caseId });
  if (!input.id || !input.caseId || !input.draftHash || Number.isNaN(Date.parse(input.requestedAt)) || Object.keys(input.payload).length === 0) throw new Error("INVALID_PENDING_EFFECT");
  return { id: input.id, tenantId: input.tenantId, caseId: input.caseId, kind: input.kind, payload: structuredClone(input.payload), status: "pending", requestedBy: input.principal.userId, requestedAt: input.requestedAt, draftHash: input.draftHash };
}
