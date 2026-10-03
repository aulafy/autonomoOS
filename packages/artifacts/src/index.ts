import type { ActorRef,RecordProvenance } from "@agent-world/decision-ledger";
import { canonicalRecord,recordDigest,recordKeys,recordCheck,recordId,recordTimestamp,validateActorRef,validateProvenance } from "@agent-world/decision-ledger";
export interface ArtifactRecord {
  id: string; taskId: string; workUnitId?: string; kind: string; uri: string;
  digest?: string; mediaType?: string; provenance: RecordProvenance[]; createdBy: ActorRef; createdAt: number;
}
/** Metadata only: no URI fetching, filesystem reads or execution authority. */
export class ArtifactRegistry {
  private records = new Map<string,ArtifactRecord>();
  append(input: ArtifactRecord): { artifactId: string; recordDigest: string } {
    const record=structuredClone(input); canonicalRecord(record);
    recordKeys(record,["id","taskId","workUnitId","kind","uri","digest","mediaType","provenance","createdBy","createdAt"]);
    recordCheck([record.id,record.taskId,record.kind].every(recordId) && recordTimestamp(record.createdAt));
    if (record.workUnitId !== undefined) recordCheck(recordId(record.workUnitId));
    recordCheck(typeof record.uri === "string" && record.uri.length <= 4096 && !/[\u0000-\u001f]/.test(record.uri));
    const uri=new URL(record.uri); recordCheck(["resource:","artifact:","file:","https:"].includes(uri.protocol) && !uri.username && !uri.password);
    if (record.digest !== undefined) recordCheck(/^sha256:[a-f0-9]{64}$/.test(record.digest));
    if (record.mediaType !== undefined) recordCheck(typeof record.mediaType === "string" && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(record.mediaType));
    validateActorRef(record.createdBy); validateProvenance(record.provenance,record.createdAt);
    const existing=this.records.get(record.id);
    if (existing && canonicalRecord(existing)!==canonicalRecord(record)) throw new Error("ARTIFACT_ID_CONFLICT");
    this.records.set(record.id,record); return { artifactId:record.id,recordDigest:recordDigest(record) };
  }
  get(id: string): ArtifactRecord | undefined { const value=this.records.get(id); return value ? structuredClone(value) : undefined; }
  list(taskId: string,workUnitId?: string): ArtifactRecord[] { return [...this.records.values()].filter(value => value.taskId===taskId && (workUnitId===undefined || value.workUnitId===workUnitId)).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(value => structuredClone(value)); }
}
