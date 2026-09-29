import { requirePermission, type WorkspacePrincipal, type WorkspaceResource } from "./workspace-policy.js";

export type CaseState = "received" | "pending_identity" | "classified" |
  "preparing_data" | "offer_received" | "pending_review" | "approved" |
  "executing" | "confirmed" | "uncertain" | "rejected";

export interface WorkspaceCase {
  id: string;
  tenantId: string;
  state: CaseState;
  version: number;
  updatedAt: string;
}

export interface CaseTransition {
  from: CaseState;
  to: CaseState;
  operation: "prepareQuote" | "approveOffer" | "executeEffect";
}

const transitions: readonly CaseTransition[] = [
  { from: "received", to: "pending_identity", operation: "prepareQuote" },
  { from: "pending_identity", to: "classified", operation: "prepareQuote" },
  { from: "classified", to: "preparing_data", operation: "prepareQuote" },
  { from: "preparing_data", to: "offer_received", operation: "prepareQuote" },
  { from: "offer_received", to: "pending_review", operation: "prepareQuote" },
  { from: "pending_review", to: "approved", operation: "approveOffer" },
  { from: "approved", to: "executing", operation: "executeEffect" },
  { from: "executing", to: "confirmed", operation: "executeEffect" },
  { from: "executing", to: "uncertain", operation: "executeEffect" },
  { from: "pending_review", to: "rejected", operation: "approveOffer" },
  { from: "uncertain", to: "executing", operation: "executeEffect" }
];

function transition(from: CaseState, to: CaseState): CaseTransition | null {
  return transitions.find(value => value.from === from && value.to === to) ?? null;
}

export function transitionCase(input: {
  current: WorkspaceCase;
  to: CaseState;
  principal: WorkspacePrincipal;
  at: string;
}): WorkspaceCase {
  if (Number.isNaN(Date.parse(input.at))) throw new Error("INVALID_CASE_TIMESTAMP");
  const selected = transition(input.current.state, input.to);
  if (!selected) throw new Error("CASE_TRANSITION_NOT_ALLOWED");
  const resource: WorkspaceResource = { tenantId: input.current.tenantId, id: input.current.id };
  requirePermission(input.principal, selected.operation, resource);
  return { ...input.current, state: input.to, version: input.current.version + 1,
    updatedAt: input.at };
}

export function transitionTable(): readonly CaseTransition[] { return transitions; }
