import type { DecisionRecord } from "./types.js";
import { canonicalRecord,recordDigest,recordKeys,recordCheck,recordId,recordTimestamp,validateActorRef,validateProvenance } from "./validation.js";
export class DecisionLedger {
  private records = new Map<string,DecisionRecord>();
  private successors = new Map<string,string>();
  append(input: DecisionRecord): { decisionId: string; digest: string } {
    const record = structuredClone(input); canonicalRecord(record);
    recordKeys(record,["id","taskId","workUnitId","question","choice","rationale","madeBy","authority","evidenceRefs","supersedes","provenance","createdAt"]);
    recordCheck(recordId(record.id) && recordId(record.taskId) && typeof record.question === "string" && !!record.question.trim() && record.question.length <= 10000 && recordTimestamp(record.createdAt));
    if (record.workUnitId !== undefined) recordCheck(recordId(record.workUnitId));
    if (record.rationale !== undefined) recordCheck(typeof record.rationale === "string" && record.rationale.length <= 30000);
    recordCheck(Array.isArray(record.evidenceRefs) && record.evidenceRefs.every(recordId) && new Set(record.evidenceRefs).size === record.evidenceRefs.length);
    validateActorRef(record.madeBy); validateProvenance(record.provenance,record.createdAt);
    recordKeys(record.authority,["principalId","role","authorizationRef"]);
    recordCheck([record.authority.principalId,record.authority.role,record.authority.authorizationRef].every(recordId));
    const existing = this.records.get(record.id);
    if (existing) {
      if (canonicalRecord(existing) !== canonicalRecord(record)) throw new Error("DECISION_ID_CONFLICT");
      return { decisionId: record.id,digest:recordDigest(record) };
    }
    if (record.supersedes !== undefined) {
      recordCheck(recordId(record.supersedes));
      const previous=this.records.get(record.supersedes);
      if (!previous || previous.taskId !== record.taskId || previous.workUnitId !== record.workUnitId || previous.question !== record.question) throw new Error("DECISION_SUPERSESSION_SCOPE_MISMATCH");
      if (this.successors.has(previous.id)) throw new Error("DECISION_ALREADY_SUPERSEDED");
      if (record.createdAt < previous.createdAt) throw new Error("DECISION_TIME_REGRESSION");
      this.successors.set(previous.id,record.id);
    } else if (this.current(record.taskId,record.workUnitId).some(value => value.question===record.question)) throw new Error("DECISION_REPLACEMENT_REQUIRES_SUPERSESSION");
    this.records.set(record.id,record); return { decisionId:record.id,digest:recordDigest(record) };
  }
  get(id: string): DecisionRecord | undefined { const value=this.records.get(id); return value ? structuredClone(value) : undefined; }
  history(taskId: string): DecisionRecord[] { return [...this.records.values()].filter(value => value.taskId===taskId).sort((a,b) => a.createdAt-b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(value => structuredClone(value)); }
  current(taskId: string,workUnitId?: string): DecisionRecord[] { return this.history(taskId).filter(value => value.workUnitId===workUnitId && !this.successors.has(value.id)); }
  resolveCurrent(id: string): DecisionRecord | undefined { let current=id; while (this.successors.has(current)) current=this.successors.get(current)!; return this.get(current); }
}
