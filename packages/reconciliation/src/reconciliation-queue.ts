import type { ReconciliationDecision, ReconciliationJob } from "./reconciliation.js";

export class ReconciliationError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ReconciliationError"; }
}

export class InMemoryReconciliationQueue {
  private readonly jobs = new Map<string, ReconciliationJob>();
  private readonly byEffect = new Map<string, string>();
  private readonly decisions: ReconciliationDecision[] = [];

  enqueue(job: ReconciliationJob): ReconciliationJob {
    if (this.jobs.has(job.id) || this.byEffect.has(job.effectId)) {
      throw new ReconciliationError("RECONCILIATION_ALREADY_QUEUED");
    }
    const stored = structuredClone(job);
    this.jobs.set(stored.id, stored);
    this.byEffect.set(stored.effectId, stored.id);
    return structuredClone(stored);
  }

  get(id: string): ReconciliationJob | null {
    const job = this.jobs.get(id);
    return job ? structuredClone(job) : null;
  }

  findByEffect(effectId: string): ReconciliationJob | null {
    const id = this.byEffect.get(effectId);
    return id ? this.get(id) : null;
  }

  list(): ReconciliationJob[] { return [...this.jobs.values()].map(job => structuredClone(job)); }
  listDecisions(effectId?: string): ReconciliationDecision[] {
    return this.decisions.filter(d => !effectId || d.effectId === effectId).map(d => structuredClone(d));
  }

  update(next: ReconciliationJob, expectedVersion: number): ReconciliationJob {
    const current = this.jobs.get(next.id);
    if (!current) throw new ReconciliationError("RECONCILIATION_NOT_FOUND");
    if (current.version !== expectedVersion || next.version !== expectedVersion + 1) {
      throw new ReconciliationError("VERSION_CONFLICT");
    }
    if (current.effectId !== next.effectId || current.maxAttempts !== next.maxAttempts ||
      current.createdAt !== next.createdAt || next.attempts < current.attempts ||
      next.attempts > current.maxAttempts) {
      throw new ReconciliationError("INVALID_RECONCILIATION_UPDATE");
    }
    if (!((current.status === "queued" && next.status === "running" && next.attempts === current.attempts + 1) ||
      (current.status === "running" && ["queued", "resolved", "exhausted"].includes(next.status) &&
        next.attempts === current.attempts))) {
      throw new ReconciliationError("INVALID_RECONCILIATION_TRANSITION");
    }
    const stored = structuredClone(next);
    this.jobs.set(next.id, stored);
    return structuredClone(stored);
  }

  appendDecision(decision: ReconciliationDecision): ReconciliationDecision {
    const job = this.jobs.get(decision.jobId);
    if (!job || job.effectId !== decision.effectId || job.status !== "running" ||
      job.attempts !== decision.attempt || !decision.reason || !decision.reconcilerId) {
      throw new ReconciliationError("INVALID_RECONCILIATION_DECISION");
    }
    if (this.decisions.some(item => item.id === decision.id)) {
      throw new ReconciliationError("RECONCILIATION_DECISION_EXISTS");
    }
    if (decision.supersedesDecisionId) {
      if (decision.supersedesDecisionId === decision.id) {
        throw new ReconciliationError("INVALID_DECISION_SUPERSESSION");
      }
      const previous = this.decisions.find(item => item.id === decision.supersedesDecisionId);
      if (!previous || previous.effectId !== decision.effectId ||
        previous.jobId !== decision.jobId || previous.attempt >= decision.attempt ||
        this.decisions.some(item => item.supersedesDecisionId === previous.id)) {
        throw new ReconciliationError("INVALID_DECISION_SUPERSESSION");
      }
    } else if (this.decisions.some(item => item.effectId === decision.effectId)) {
      throw new ReconciliationError("INVALID_DECISION_SUPERSESSION");
    }
    const stored = structuredClone(decision);
    this.decisions.push(stored);
    return structuredClone(stored);
  }
}
