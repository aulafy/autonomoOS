import type { EffectTransaction } from "@agent-world/effects";
import type { Observation } from "@agent-world/observation";

export type ReconciliationOutcome = "confirmed_effect" | "confirmed_no_effect" |
  "ambiguous" | "conflicting" | "superseded";
export type JobStatus = "queued" | "running" | "resolved" | "exhausted";

export interface ReconciliationJob {
  id: string;
  effectId: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: number;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  version: number;
}

export interface ReconciliationDecision {
  id: string;
  jobId: string;
  effectId: string;
  attempt: number;
  outcome: ReconciliationOutcome;
  observationIds: string[];
  reason: string;
  reconcilerId: string;
  at: number;
  supersedesDecisionId?: string;
  noEffectCertificate?: NoEffectCertificate;
  supersessionReference?: string;
}

export interface NoEffectCertificate {
  kind: "idempotency_key_never_processed";
  idempotencyKey: string;
  authority: string;
  reference: string;
}

export type ReconcileResult =
  | { kind: "observations"; observations: Observation[];
      noEffectCertificate?: NoEffectCertificate; retryAfterMs?: number }
  | { kind: "superseded"; reason: string; reference: string };

export interface Reconciler {
  readonly id: string;
  supports(effect: EffectTransaction): boolean;
  /** Read-only lookup of external reality. Never dispatches the original action. */
  reconcile(effect: EffectTransaction, attempt: number, signal: AbortSignal): Promise<ReconcileResult>;
}
