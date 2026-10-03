import type { JsonValue } from "@agent-world/task-runtime";
import type { ActorRef,RecordProvenance } from "@agent-world/decision-ledger";
import { canonicalRecord,recordDigest,recordKeys,recordCheck,recordId,recordTimestamp,validateActorRef,validateProvenance } from "@agent-world/decision-ledger";
export type EvidenceStrength = "claim" | "observed" | "independently-verified";
export type EvidenceSource =
  | { kind:"verification-unavailable"; verifierId:string; criterionId:string }
  | { kind:"provider-report"; providerId:string; providerMessageId:string }
  | { kind:"observation"; observationId:string; effectId?:string }
  | { kind:"verifier"; verifierId:string; criterionId:string; observationRefs:string[] }
  | { kind:"human"; approvalId:string; principalId:string };
export interface EvidenceRecord {
  id:string; taskId:string; workUnitId?:string; attemptId?:string; claim:string;
  source:EvidenceSource; strength:EvidenceStrength; payloadRef?:string; structuredPayload?:JsonValue;
  observedBy:ActorRef; provenance:RecordProvenance[]; createdAt:number;
}
/** Trusted host ledger. Strength is checked structurally; actual observation/authority
 * validation belongs to the governed collector/verifier, not model-supplied fields. */
export class EvidenceLedger {
  private records=new Map<string,EvidenceRecord>();
  append(input:EvidenceRecord): { evidenceId:string; digest:string } {
    const record=structuredClone(input); canonicalRecord(record);
    recordKeys(record,["id","taskId","workUnitId","attemptId","claim","source","strength","payloadRef","structuredPayload","observedBy","provenance","createdAt"]);
    recordCheck(recordId(record.id) && recordId(record.taskId) && typeof record.claim==="string" && !!record.claim.trim() && record.claim.length<=30000 && recordTimestamp(record.createdAt));
    if (record.workUnitId!==undefined) recordCheck(recordId(record.workUnitId));
    if (record.attemptId!==undefined) recordCheck(recordId(record.attemptId) && record.workUnitId!==undefined);
    if (record.payloadRef!==undefined) recordCheck(recordId(record.payloadRef));
    recordCheck(["claim","observed","independently-verified"].includes(record.strength));
    validateActorRef(record.observedBy); validateProvenance(record.provenance,record.createdAt);
    const source=record.source; recordCheck(source && typeof source==="object");
    switch(source.kind) {
      case "verification-unavailable":
        recordKeys(source,["kind","verifierId","criterionId"]);
        recordCheck(recordId(source.verifierId) && recordId(source.criterionId) && record.attemptId!==undefined && record.strength==="observed" && record.observedBy.kind==="host");
        break;
      case "provider-report":
        recordKeys(source,["kind","providerId","providerMessageId"]);
        recordCheck(recordId(source.providerId) && recordId(source.providerMessageId));
        if (record.strength!=="claim") throw new Error("PROVIDER_REPORT_IS_NOT_VERIFIED_EVIDENCE");
        break;
      case "observation":
        recordKeys(source,["kind","observationId","effectId"]);
        recordCheck(recordId(source.observationId)); if (source.effectId!==undefined) recordCheck(recordId(source.effectId));
        if (record.strength==="independently-verified") throw new Error("OBSERVATION_REQUIRES_VERIFIER_FOR_PROMOTION");
        break;
      case "verifier":
        recordKeys(source,["kind","verifierId","criterionId","observationRefs"]);
        recordCheck(recordId(source.verifierId) && recordId(source.criterionId) && Array.isArray(source.observationRefs) && source.observationRefs.length>0 && source.observationRefs.every(recordId) && new Set(source.observationRefs).size===source.observationRefs.length);
        recordCheck(record.attemptId!==undefined);
        break;
      case "human":
        recordKeys(source,["kind","approvalId","principalId"]);
        recordCheck(recordId(source.approvalId) && recordId(source.principalId));
        if (record.strength==="independently-verified") throw new Error("HUMAN_APPROVAL_REQUIRES_VERIFIER");
        break;
      default: throw new Error("INVALID_EVIDENCE_SOURCE");
    }
    const previous=this.records.get(record.id);
    if (previous && canonicalRecord(previous)!==canonicalRecord(record)) throw new Error("EVIDENCE_ID_CONFLICT");
    this.records.set(record.id,record); return { evidenceId:record.id,digest:recordDigest(record) };
  }
  get(id:string):EvidenceRecord|undefined { const record=this.records.get(id); return record ? structuredClone(record) : undefined; }
  list(taskId:string,attemptId?:string):EvidenceRecord[] { return [...this.records.values()].filter(record => record.taskId===taskId && (attemptId===undefined || record.attemptId===attemptId)).sort((a,b) => a.createdAt-b.createdAt || (a.id<b.id ? -1 : a.id>b.id ? 1 : 0)).map(record => structuredClone(record)); }
  forCriterion(taskId:string,attemptId:string,criterionId:string):EvidenceRecord[] { return this.list(taskId,attemptId).filter(record => record.source.kind==="verifier" && record.source.criterionId===criterionId); }
}
