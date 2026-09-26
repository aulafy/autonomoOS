export type Severity = "info" | "warning" | "critical" | "emergency";
export type TaskStatus = "running" | "paused" | "cancelled" | "completed";
export interface TaskSnapshot {
  id: string;
  status: TaskStatus;
  deadlineAt: number;
  lastProgressAt: number;
  requiredEffectIds: string[];
}
export interface LeaseSnapshot { id: string; taskId: string; expiresAt: number; active: boolean; }
export interface BudgetSnapshot { id: string; taskId: string; expiresAt: number;
  exhausted: boolean; active: boolean; }
export type EffectStatus = "preparing" | "prepared" | "dispatching" |
  "committed" | "failed" | "unknown";
export interface EffectSnapshot { id: string; taskId: string; executorId: string;
  status: EffectStatus; createdAt: number; preparedAt?: number;
  dispatchStartedAt?: number; observationIds: string[]; required: boolean;
  effectiveOutcome?: "committed" | "failed" | "unknown"; }
export interface ReconciliationSnapshot { id: string; effectId: string;
  status: "queued" | "running" | "resolved" | "exhausted";
  nextAttemptAt: number; attempts: number; maxAttempts: number; }
export interface ComponentHealth { id: string; kind: "executor" | "provider" | "policy" |
  "event_store" | "observer" | "other"; healthy: boolean; }
export interface QuarantineEntry { id: string; executorId: string; reason: string;
  createdAt: number; active: boolean; }
export interface EmergencyStopState { active: boolean; reason?: string; activatedAt?: number; }
export interface RuntimeSnapshot {
  now: number;
  tasks: TaskSnapshot[];
  authorityLeases: LeaseSnapshot[];
  resourceLeases: LeaseSnapshot[];
  budgets: BudgetSnapshot[];
  effects: EffectSnapshot[];
  reconciliations: ReconciliationSnapshot[];
  components: ComponentHealth[];
  quarantines: QuarantineEntry[];
  emergencyStop: EmergencyStopState;
  policyAvailable: boolean;
  eventStoreAvailable: boolean;
  unknownRateByExecutor: Record<string, number>;
}

export interface SupervisorFinding { id: string; ruleId: string; severity: Severity;
  code: string; taskId?: string; effectId?: string; componentId?: string;
  detectedAt: number; explanation: string; }
export type SupervisorActionKind = "pause_task" | "cancel_task" | "stop_before_dispatch" |
  "request_reconciliation" | "escalate_human" | "mark_runtime_degraded" |
  "quarantine_executor" | "request_safe_cleanup" | "emit_incident";
export interface SupervisorAction { kind: SupervisorActionKind; subjectId: string; reason: string; }
export interface SupervisorDecision { evaluatedAt: number; findings: SupervisorFinding[];
  actions: SupervisorAction[]; }
export interface SupervisorRule { id: string; evaluate(snapshot: RuntimeSnapshot): SupervisorFinding[]; }
export class SupervisorError extends Error {
  constructor(readonly code: string) { super(code); this.name = "SupervisorError"; }
}
