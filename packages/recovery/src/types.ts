export type RuntimeMode = "recovering" | "normal" | "degraded" | "read_only" |
  "emergency_stop";

export class RuntimeModeController {
  private current: RuntimeMode = "recovering";
  get mode(): RuntimeMode { return this.current; }
  allowsConsequentialDispatch(): boolean { return this.current === "normal"; }
  enterNormal(): void {
    if (this.current !== "recovering") {
      throw new Error("INVALID_RUNTIME_MODE_TRANSITION");
    }
    this.current = "normal";
  }
  enterReadOnly(): void { this.current = "read_only"; }
  enterEmergencyStop(): void { this.current = "emergency_stop"; }
}

export type RecoveryActionKind = "cleanup_pre_dispatch" | "mark_dispatching_unknown" |
  "ensure_reconciliation" | "repair_committed_budget" | "cleanup_failed_budget" |
  "cleanup_orphan_reservation";
export interface RecoveryAction { id: string; effectId: string; kind: RecoveryActionKind;
  observedVersion: number; reservationId?: string; }
export interface RecoveryPlan { id: string; createdAt: number; actions: RecoveryAction[]; }
export interface RecoveryEvent { type: "recovery.started" | "recovery.action_applied" |
  "recovery.action_failed" | "recovery.completed"; planId: string;
  actionId?: string; reason?: string; at: number; }
export interface RecoveryEventSink { append(event: RecoveryEvent): void; }
export class InMemoryRecoveryEventSink implements RecoveryEventSink {
  readonly events: RecoveryEvent[] = [];
  append(event: RecoveryEvent): void { this.events.push(structuredClone(event)); }
}
