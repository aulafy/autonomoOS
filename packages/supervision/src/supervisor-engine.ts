import { builtinSupervisorRules, type SupervisorThresholds } from "./builtin-rules.js";
import { SupervisorError, type RuntimeSnapshot, type SupervisorAction,
  type SupervisorDecision, type SupervisorFinding, type SupervisorRule } from "./types.js";

export type OperationKind = "consequential" | "diagnostic" | "observation" |
  "reconciliation" | "forensic_read";

export class SupervisorEngine {
  private readonly rules: readonly SupervisorRule[];
  constructor(thresholds: SupervisorThresholds, rules?: readonly SupervisorRule[]) {
    if (Object.values(thresholds).some(value => !Number.isFinite(value) || value < 0)) {
      throw new SupervisorError("INVALID_SUPERVISOR_THRESHOLDS");
    }
    this.rules = rules ?? builtinSupervisorRules(thresholds);
  }

  tick(snapshot: RuntimeSnapshot): SupervisorDecision {
    if (!Number.isFinite(snapshot.now)) throw new SupervisorError("INVALID_RUNTIME_SNAPSHOT");
    const findings = this.rules.flatMap(rule => rule.evaluate(structuredClone(snapshot)));
    const actions = findings.flatMap(finding => this.actionsFor(finding));
    return { evaluatedAt: snapshot.now, findings, actions };
  }

  mayStart(snapshot: RuntimeSnapshot, kind: OperationKind, executorId?: string): boolean {
    if (kind !== "consequential") return true;
    if (snapshot.emergencyStop.active || !snapshot.policyAvailable ||
      !snapshot.eventStoreAvailable) return false;
    if (executorId && snapshot.quarantines.some(entry => entry.active &&
      entry.executorId === executorId)) return false;
    if (executorId && snapshot.components.some(component => component.id === executorId &&
      !component.healthy)) return false;
    return true;
  }

  private actionsFor(finding: SupervisorFinding): SupervisorAction[] {
    const subjectId = finding.effectId ?? finding.taskId ?? finding.componentId ?? "runtime";
    const action = (kind: SupervisorAction["kind"]): SupervisorAction =>
      ({ kind, subjectId, reason: finding.code });
    switch (finding.code) {
      case "EMERGENCY_STOP_ACTIVE": return [action("stop_before_dispatch")];
      case "TASK_DEADLINE_EXCEEDED": return [action("cancel_task")];
      case "TASK_STALLED": return [action("pause_task"), action("escalate_human")];
      case "AUTHORITY_LEASE_EXPIRED":
      case "RESOURCE_LEASE_EXPIRED":
      case "BUDGET_EXHAUSTED":
      case "BUDGET_EXPIRED": return [action("stop_before_dispatch")];
      case "EFFECT_PREPARING_STUCK": return [action("request_safe_cleanup")];
      case "EFFECT_OUTCOME_UNCERTAIN":
      case "RECONCILIATION_MISSING":
      case "RECONCILIATION_DUE": return [action("request_reconciliation")];
      case "RECONCILIATION_EXHAUSTED": return [action("escalate_human")];
      case "COMPONENT_UNHEALTHY":
      case "EXECUTOR_HIGH_UNKNOWN_RATE": return [action("quarantine_executor"),
        action("mark_runtime_degraded")];
      case "POLICY_UNAVAILABLE":
      case "EVENT_STORE_UNAVAILABLE": return [action("stop_before_dispatch"),
        action("mark_runtime_degraded")];
      case "UNKNOWN_BACKLOG_TOO_LARGE": return [action("mark_runtime_degraded"),
        action("escalate_human")];
      default: return [action("emit_incident")];
    }
  }
}
