import type { RuntimeSnapshot, Severity, SupervisorFinding, SupervisorRule } from "./types.js";

export interface SupervisorThresholds {
  stalledTaskMs: number;
  preparingMs: number;
  dispatchingMs: number;
  maxUnknownBacklog: number;
  highUnknownRate: number;
}

function finding(snapshot: RuntimeSnapshot, ruleId: string, severity: Severity,
  code: string, subject: { taskId?: string; effectId?: string; componentId?: string } = {}): SupervisorFinding {
  return { id: `${ruleId}:${subject.taskId ?? subject.effectId ?? subject.componentId ?? "runtime"}`,
    ruleId, severity, code, ...subject, detectedAt: snapshot.now, explanation: code };
}

function rule(id: string, evaluate: (snapshot: RuntimeSnapshot) => SupervisorFinding[]): SupervisorRule {
  return { id, evaluate };
}

export function builtinSupervisorRules(thresholds: SupervisorThresholds): readonly SupervisorRule[] {
  return [
    rule("EMERGENCY_STOP", s => s.emergencyStop.active
      ? [finding(s, "EMERGENCY_STOP", "emergency", "EMERGENCY_STOP_ACTIVE")] : []),
    rule("TASK_DEADLINE", s => s.tasks.filter(t => t.status === "running" && s.now >= t.deadlineAt)
      .map(t => finding(s, "TASK_DEADLINE", "critical", "TASK_DEADLINE_EXCEEDED", { taskId: t.id }))),
    rule("TASK_STALLED", s => s.tasks.filter(t => t.status === "running" &&
      s.now - t.lastProgressAt >= thresholds.stalledTaskMs)
      .map(t => finding(s, "TASK_STALLED", "warning", "TASK_STALLED", { taskId: t.id }))),
    rule("AUTHORITY_LEASE_EXPIRED", s => s.authorityLeases.filter(l => l.active && s.now >= l.expiresAt)
      .map(l => finding(s, "AUTHORITY_LEASE_EXPIRED", "critical", "AUTHORITY_LEASE_EXPIRED",
        { taskId: l.taskId }))),
    rule("RESOURCE_LEASE_EXPIRED", s => s.resourceLeases.filter(l => l.active && s.now >= l.expiresAt)
      .map(l => finding(s, "RESOURCE_LEASE_EXPIRED", "critical", "RESOURCE_LEASE_EXPIRED",
        { taskId: l.taskId }))),
    rule("BUDGET_UNAVAILABLE", s => s.budgets.filter(b => b.active &&
      (b.exhausted || s.now >= b.expiresAt))
      .map(b => finding(s, "BUDGET_UNAVAILABLE", "critical",
        b.exhausted ? "BUDGET_EXHAUSTED" : "BUDGET_EXPIRED", { taskId: b.taskId }))),
    rule("EFFECT_PREPARING_STUCK", s => s.effects.filter(e => e.status === "preparing" &&
      s.now - e.createdAt >= thresholds.preparingMs)
      .map(e => finding(s, "EFFECT_PREPARING_STUCK", "warning", "EFFECT_PREPARING_STUCK",
        { taskId: e.taskId, effectId: e.id }))),
    rule("EFFECT_DISPATCHING_STUCK", s => s.effects.filter(e => e.status === "dispatching" &&
      e.dispatchStartedAt !== undefined && s.now - e.dispatchStartedAt >= thresholds.dispatchingMs)
      .map(e => finding(s, "EFFECT_DISPATCHING_STUCK", "critical", "EFFECT_OUTCOME_UNCERTAIN",
        { taskId: e.taskId, effectId: e.id }))),
    rule("UNKNOWN_NO_RECONCILIATION", s => s.effects.filter(e => e.status === "unknown" &&
      !s.reconciliations.some(r => r.effectId === e.id))
      .map(e => finding(s, "UNKNOWN_NO_RECONCILIATION", "critical", "RECONCILIATION_MISSING",
        { taskId: e.taskId, effectId: e.id }))),
    rule("RECONCILIATION_DUE", s => s.reconciliations.filter(r => r.status === "queued" &&
      s.now >= r.nextAttemptAt).map(r => finding(s, "RECONCILIATION_DUE", "warning",
      "RECONCILIATION_DUE", { effectId: r.effectId }))),
    rule("RECONCILIATION_EXHAUSTED", s => s.reconciliations.filter(r => r.status === "exhausted")
      .map(r => finding(s, "RECONCILIATION_EXHAUSTED", "critical",
        "RECONCILIATION_EXHAUSTED", { effectId: r.effectId }))),
    rule("COMPONENT_UNHEALTHY", s => s.components.filter(c => !c.healthy)
      .map(c => finding(s, "COMPONENT_UNHEALTHY", "critical", "COMPONENT_UNHEALTHY",
        { componentId: c.id }))),
    rule("POLICY_UNAVAILABLE", s => !s.policyAvailable
      ? [finding(s, "POLICY_UNAVAILABLE", "critical", "POLICY_UNAVAILABLE")] : []),
    rule("EVENT_STORE_UNAVAILABLE", s => !s.eventStoreAvailable
      ? [finding(s, "EVENT_STORE_UNAVAILABLE", "critical", "EVENT_STORE_UNAVAILABLE")] : []),
    rule("UNKNOWN_BACKLOG", s => s.effects.filter(e => e.status === "unknown" &&
      (e.effectiveOutcome ?? "unknown") === "unknown").length >
      thresholds.maxUnknownBacklog
      ? [finding(s, "UNKNOWN_BACKLOG", "critical", "UNKNOWN_BACKLOG_TOO_LARGE")] : []),
    rule("EXECUTOR_UNKNOWN_RATE", s => Object.entries(s.unknownRateByExecutor)
      .filter(([, rate]) => rate >= thresholds.highUnknownRate)
      .map(([id]) => finding(s, "EXECUTOR_UNKNOWN_RATE", "critical",
        "EXECUTOR_HIGH_UNKNOWN_RATE", { componentId: id }))),
    rule("RECONCILIATION_MISMATCH", s => s.reconciliations.filter(r =>
      s.effects.find(e => e.id === r.effectId)?.status !== "unknown")
      .map(r => finding(s, "RECONCILIATION_MISMATCH", "critical",
        "RECONCILIATION_EFFECT_MISMATCH", { effectId: r.effectId }))),
    rule("COMMITTED_UNOBSERVED", s => s.effects.filter(e => e.status === "committed" &&
      e.observationIds.length === 0)
      .map(e => finding(s, "COMMITTED_UNOBSERVED", "critical", "COMMITTED_WITHOUT_OBSERVATION",
        { taskId: e.taskId, effectId: e.id }))),
    rule("COMPLETED_UNRESOLVED", s => s.tasks.filter(t => t.status === "completed" &&
      t.requiredEffectIds.some(id => {
        const e = s.effects.find(effect => effect.id === id);
        return !e || ["preparing", "prepared", "dispatching", "failed"].includes(e.status) ||
          (e.status === "unknown" && e.effectiveOutcome !== "committed");
      })).map(t => finding(s, "COMPLETED_UNRESOLVED", "critical",
      "COMPLETED_WITH_UNRESOLVED_EFFECT", { taskId: t.id })))
  ];
}
