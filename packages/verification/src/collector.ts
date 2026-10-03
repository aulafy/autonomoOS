import type { GovernedActionRunner,GovernedActionRequest } from "@agent-world/control-plane";
import type { ObservationStore,Observation,ObserverRegistry } from "@agent-world/observation";
import type { JsonValue } from "@agent-world/task-runtime";
import { canonicalRecord,recordDigest } from "@agent-world/decision-ledger";
import type { VerificationCollector,VerificationInput,CollectedVerification } from "./types.js";
export function verificationCollectionKey(input:VerificationInput):string {
  return `collection:${recordDigest({ taskId:input.taskId,workUnitId:input.workUnitId,attemptId:input.attemptId,criterion:input.criterion }).slice(7)}`;
}
interface CollectionRecord { key:string; prepared?:{ effectId:string; intentId:string }; result?:CollectedVerification }
/** Durable claim must precede admission/dispatch. No implicit retry of a claimed job. */
export class VerificationCollectionStore {
  private records=new Map<string,CollectionRecord>();
  claim(key:string):boolean { if (!/^collection:[a-f0-9]{64}$/.test(key)) throw new Error("INVALID_COLLECTION_KEY"); if (this.records.has(key)) return false; this.records.set(key,{key}); return true; }
  prepared(key:string,effectId:string,intentId:string):{ key:string; effectId:string; intentId:string } {
    const record=this.records.get(key); if (!record || record.prepared || record.result) throw new Error("INVALID_COLLECTION_TRANSITION");
    record.prepared={effectId,intentId}; return {key,effectId,intentId};
  }
  finish(key:string,result:CollectedVerification):{ key:string; digest:string } {
    const record=this.records.get(key); if (!record) throw new Error("COLLECTION_NOT_CLAIMED");
    if (record.result && canonicalRecord(record.result)!==canonicalRecord(result)) throw new Error("COLLECTION_RESULT_CONFLICT");
    record.result=structuredClone(result); return {key,digest:recordDigest(result)};
  }
  get(key:string):CollectionRecord|undefined { const record=this.records.get(key); return record ? structuredClone(record) : undefined; }
}
export interface GovernedCollectorOptions {
  runner:Pick<GovernedActionRunner,"admit"|"dispatchPrepared">; observations:ObservationStore; observers:ObserverRegistry; store:VerificationCollectionStore;
  /** Host maps the criterion to a configured, authorized action/resource. */
  plan(input:VerificationInput,key:string):Promise<GovernedActionRequest>;
  observerIds:string[];
  /** Trusted observer-specific payload decoder, never a worker's success report. */
  decode(observation:Observation,input:VerificationInput):JsonValue;
}
export class GovernedVerificationCollector implements VerificationCollector {
  constructor(private options:GovernedCollectorOptions) { if (!options.observerIds.length) throw new Error("VERIFICATION_OBSERVERS_REQUIRED"); }
  async collect(input:VerificationInput,signal:AbortSignal):Promise<CollectedVerification> {
    const key=verificationCollectionKey(input),existing=this.options.store.get(key);
    if (existing) return existing.result ?? {status:"unknown",reason:"collection_reconciliation_required"};
    if (signal.aborted) return {status:"unknown",reason:"collection_aborted_before_claim"};
    if (!this.options.store.claim(key)) return {status:"unknown",reason:"collection_already_claimed"};
    const unknown=(reason:string):CollectedVerification => { const result:CollectedVerification={status:"unknown",reason}; this.options.store.finish(key,result); return result; };
    try {
      const request=await this.options.plan(structuredClone(input),key);
      if (request.taskId!==input.taskId || request.correlationId!==key || request.intent.parameters?.verificationCriterionDigest!==recordDigest(input.criterion)) return unknown("verification_action_scope_mismatch");
      const prepared=await this.options.runner.admit(request);
      this.options.store.prepared(key,prepared.effectId,request.intent.id);
      const outcome=await this.options.runner.dispatchPrepared(prepared,signal);
      if (!["completed","failed"].includes(outcome.status) || outcome.taskId!==input.taskId || outcome.intentId!==request.intent.id || outcome.effectId!==prepared.effectId || !outcome.observationIds.length) return unknown("governed_collection_unconfirmed");
      const observations=outcome.observationIds.map(id => this.options.observations.get(id));
      if (observations.some(observation => !observation || !this.options.observerIds.includes(observation.observerId) || ["provider","fixture"].includes(observation.source) || !["confirmed","contradicted"].includes(observation.status) || observation.subject.taskId!==input.taskId || observation.subject.effectId!==prepared.effectId || observation.subject.intentId!==request.intent.id || !observation.subject.resourceIds.includes(prepared.canonicalResourceId))) return unknown("verification_observation_unbound");
      const concrete=observations.map(value => value!);
      if (concrete.some(observation => {
        const descriptor=this.options.observers.get(observation.observerId)?.descriptor;
        return !descriptor || !descriptor.authenticated || descriptor.strength!=="strong" || descriptor.sourceType!==observation.source || !["independent_local","independent_external","human"].includes(descriptor.independence);
      })) return unknown("verification_observer_not_independent");
      const payload=this.options.decode(structuredClone(concrete[0]!),structuredClone(input)); canonicalRecord(payload);
      const packet:CollectedVerification={status:"observed",taskId:input.taskId,workUnitId:input.workUnitId,attemptId:input.attemptId,criterionDigest:recordDigest(input.criterion),observationRefs:concrete.map(value => value.id),observedAt:Math.min(...concrete.map(value => value.observedAt)),payload};
      this.options.store.finish(key,packet); return packet;
    } catch { return unknown("governed_collection_error"); }
  }
}
