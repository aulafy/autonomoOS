import { recordDigest } from '@agent-world/decision-ledger';
import type { EvidenceLedger, EvidenceRecord } from '@agent-world/evidence-ledger';
import type { TaskRuntimeKernel, TaskRuntimeEvent, VerificationResult } from '@agent-world/task-runtime';
import type { VerifierRegistry } from './registry.js';
/** Host-only bridge. Stores evidence before lifecycle references. Interrupted runs remain
 * verifying; resuming and cross-store recovery belong to the durable coordinator. */
export class AttemptVerificationService {
  private active = new Set<string>();
  constructor(private readonly kernel: Pick<TaskRuntimeKernel,'snapshot'|'apply'>,
    private readonly ledger: Pick<EvidenceLedger,'append'>,
    private readonly registry: VerifierRegistry, private readonly now:()=>number) {}
  async verify(attemptId:string, maxAgeMs:number, signal?:AbortSignal):Promise<VerificationResult[]> {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs<0) throw new Error('INVALID_VERIFICATION_MAX_AGE');
    if(this.active.has(attemptId)) throw new Error('VERIFICATION_ALREADY_RUNNING');
    const snapshot=this.kernel.snapshot(); const attempt=snapshot.attempts[attemptId];
    if(!attempt || attempt.status!=='reported') throw new Error('ATTEMPT_NOT_REPORTED');
    const unit=snapshot.workUnits[attempt.workUnitId];
    if(!unit || unit.activeAttemptId!==attemptId) throw new Error('ATTEMPT_SCOPE_MISMATCH');
    this.active.add(attemptId);
    const send=(event:TaskRuntimeEvent):void=>{this.kernel.apply(event,this.kernel.snapshot().revision);};
    const verificationRound=snapshot.verifications.filter(record=>record.taskId===attempt.taskId && record.attemptId===attemptId).length+1;
    const key=`verification-${recordDigest({attemptId, taskId:attempt.taskId, verificationRound})}`;
    try {
      send({id:`${key}-start`,taskId:attempt.taskId,at:this.now(),type:'VerificationStarted',attemptId});
      const results:VerificationResult[]=[];
      for(const criterion of unit.successCriteria) {
        const result=await this.registry.verify({taskId:attempt.taskId,workUnitId:unit.id,attemptId,criterion,maxAgeMs},signal);
        const at=this.now(); const id=`${key}-${recordDigest({criterion,result})}`;
        // Unbound unknown outcomes are host records, never independently verified.
        const record:EvidenceRecord={id,taskId:attempt.taskId,workUnitId:unit.id,attemptId,
          claim:result.reason,strength:result.status==='unknown'?'observed':'independently-verified',
          source:result.observationRefs.length?{kind:'verifier',verifierId:result.verifierId,criterionId:criterion.id,observationRefs:result.observationRefs}:{kind:'verification-unavailable',verifierId:result.verifierId,criterionId:criterion.id},
          structuredPayload:{criterionId:criterion.id,status:result.status,reason:result.reason,observationRefs:result.observationRefs},
          observedBy:{id:'verification-host',kind:'host'},provenance:[{sourceRef:result.observationRefs[0]??`host-${id}`,operation:'derived',actor:{id:'verification-host',kind:'host'},createdAt:at}],createdAt:at};
        this.ledger.append(record);
        send({id:`${id}-reference`,taskId:attempt.taskId,at,type:'EvidenceRecorded',attemptId,referenceId:id});
        results.push({criterionId:criterion.id,status:result.status,evidenceRefs:[id]});
      }
      send({id:`${key}-finish`,taskId:attempt.taskId,at:this.now(),type:'VerificationCompleted',attemptId,results});
      return structuredClone(results);
    } finally {this.active.delete(attemptId);}
  }
}
