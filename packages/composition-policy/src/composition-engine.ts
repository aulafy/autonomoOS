import type { ApprovalStore } from "./approval-store.js";
import { approvalMatches } from "./approval-store.js";
import type { HistoryStore } from "./history-store.js";
import type { CandidateCompiler } from "./action-registry.js";
import { CompositionError, type CandidateRequest, type CompositionDecision,
  type CompositionRule, type CompositionVerdict } from "./types.js";

export interface Clock { now(): number; }

export class CompositionEngine {
  constructor(private readonly compiler: CandidateCompiler, private readonly history: HistoryStore,
    private readonly approvals: ApprovalStore,
    private readonly rules: readonly CompositionRule[], private readonly clock: Clock,
    private readonly maxHistoryAgeMs?: number) {
    if (maxHistoryAgeMs !== undefined &&
      (!Number.isFinite(maxHistoryAgeMs) || maxHistoryAgeMs < 0)) {
      throw new CompositionError("INVALID_HISTORY_AGE");
    }
  }

  evaluate(request: CandidateRequest, approvalId?: string): CompositionDecision {
    const candidate = this.compiler.compile(request);
    const now = this.clock.now();
    const historyVersion = this.history.currentVersion(candidate.taskId);
    const facts = this.history.listByTask(candidate.taskId).filter(fact =>
      fact.occurredAt <= now &&
      (this.maxHistoryAgeMs === undefined || now - fact.occurredAt <= this.maxHistoryAgeMs));
    const ruleResults = this.rules.map(rule => {
      const result = rule.evaluate(structuredClone(facts), structuredClone(candidate), { now });
      if (result.ruleId !== rule.id ||
        !["allow", "require_approval", "deny"].includes(result.verdict) || !result.reason) {
        throw new CompositionError("INVALID_COMPOSITION_RULE_RESULT");
      }
      return structuredClone(result);
    });
    const verdict: CompositionVerdict = ruleResults.some(r => r.verdict === "deny") ? "deny" :
      ruleResults.some(r => r.verdict === "require_approval") ? "require_approval" : "allow";
    const approval = approvalId ? this.approvals.get(approvalId) : null;
    const approved = verdict === "require_approval" && approval !== null &&
      approvalMatches(approval, candidate, historyVersion, now);
    return { taskId: candidate.taskId, intentId: candidate.intentId,
      actionType: candidate.actionType, resourceIds: [...candidate.resourceIds],
      sinkId: candidate.sinkId, verdict: approved ? "allow" : verdict,
      historyVersion, evaluatedAt: now, ruleResults,
      approvalId: approved ? approval!.id : undefined };
  }

  isCurrent(decision: CompositionDecision): boolean {
    return decision.historyVersion === this.history.currentVersion(decision.taskId);
  }
}
