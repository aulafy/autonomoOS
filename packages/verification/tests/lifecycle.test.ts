import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskRuntimeKernel, type TaskRuntimeEvent } from '@agent-world/task-runtime';
import { EvidenceLedger } from '@agent-world/evidence-ledger';
import { VerifierRegistry, AttemptVerificationService } from '../src/index.js';
function fixture(status:'satisfied'|'unsatisfied'|'unknown') {
 const kernel=new TaskRuntimeKernel();let time=0;
 const send=(body:Record<string,unknown>)=>kernel.apply({id:`e${++time}`,taskId:'task',at:time,...body} as TaskRuntimeEvent,kernel.snapshot().revision);
 const criterion={id:'check',kind:'test',command:'npm test',expectedExitCode:0};
 send({type:'GlobalTaskCreated',goal:'Verify deliverable',owner:'owner',successCriteria:[criterion]});
 send({type:'GlobalTaskPlanningStarted'});
 send({type:'PlanCommitted',planVersion:1,workUnits:[{id:'unit',title:'Deliver',objective:'Deliver checked output',dependencies:[],requiredCapabilities:[],constraints:[],expectedArtifacts:[],successCriteria:[criterion]}]});
 send({type:'AttemptCreated',workUnitId:'unit',attemptId:'attempt',providerId:'orca',actorId:'worker',dispatchFingerprint:'dispatch'});
 send({type:'AttemptReserved',attemptId:'attempt'});send({type:'AttemptDispatchStarted',attemptId:'attempt'});
 send({type:'AttemptProviderReported',attemptId:'attempt',outcome:'succeeded'});
 const ledger=new EvidenceLedger();const registry=new VerifierRegistry();
 if(status!=='unknown')registry.register({id:'test-verifier',supports:()=>true,verify:async()=>({criterionId:'check',verifierId:'test-verifier',status,reason:status==='satisfied'?'test_passed':'test_failed',observationRefs:['actual-observation'],observedAt:time})});
 return {kernel,ledger,registry,send,service:new AttemptVerificationService(kernel,ledger,registry,()=>++time)};
}
for(const status of ['satisfied','unsatisfied','unknown'] as const)test(`verification bridge retains ${status} evidence and applies kernel outcome`,async()=>{
 const {kernel,ledger,service}=fixture(status);
 const results=await service.verify('attempt',1000);
 assert.equal(results[0]!.status,status);
 assert.equal(kernel.snapshot().workUnits.unit!.status,status==='satisfied'?'succeeded':status==='unsatisfied'?'failed':'unknown');
 assert.equal(ledger.list('task','attempt').length,1);
 assert.equal(ledger.list('task','attempt')[0]!.strength,status==='unknown'?'observed':'independently-verified');
 assert.notEqual(kernel.snapshot().tasks.task!.status,'completed');
 await assert.rejects(service.verify('attempt',1000),/ATTEMPT_NOT_REPORTED/);
});
test('evidence write failure leaves verification unresolved and prevents rerunning',async()=>{
 const {kernel,service}=fixture('satisfied');
 const ledger=(service as unknown as {ledger:EvidenceLedger}).ledger;
 ledger.append=()=>{throw new Error('disk unavailable');};
 await assert.rejects(service.verify('attempt',1000),/disk unavailable/);
 assert.equal(kernel.snapshot().attempts.attempt!.status,'verifying');
 await assert.rejects(service.verify('attempt',1000),/ATTEMPT_NOT_REPORTED/);
});
test('reconciled unknown attempt can be verified again without overwriting previous evidence',async()=>{
 const {kernel,ledger,registry,send,service}=fixture('unknown');
 await service.verify('attempt',1000);
 const first=ledger.list('task','attempt')[0]!;
 ledger.append({...first,id:'reconciliation-proof',claim:'Provider status reconciled by host',source:{kind:'observation',observationId:'provider-status-observation'},createdAt:first.createdAt});
 send({type:'EvidenceRecorded',attemptId:'attempt',referenceId:'reconciliation-proof'});
 send({type:'ReconciliationCompleted',attemptId:'attempt',outcome:'reported-success',evidenceRefs:['reconciliation-proof']});
 registry.register({id:'recovered-verifier',supports:()=>true,verify:async()=>({criterionId:'check',verifierId:'recovered-verifier',status:'satisfied',reason:'new_independent_evidence',observationRefs:['new-observation'],observedAt:1})});
 const result=await service.verify('attempt',1000);
 assert.equal(result[0]!.status,'satisfied');
 assert.equal(kernel.snapshot().workUnits.unit!.status,'succeeded');
 const evidence=ledger.list('task','attempt');assert.equal(evidence.length,3);
 assert.deepEqual(ledger.get(first.id),first);
 assert.equal(kernel.snapshot().verifications.length,2);
 assert.notEqual(result[0]!.evidenceRefs[0],first.id);
});
test('new service instance derives verification round from kernel history',async()=>{
 const {kernel,ledger,registry,send,service}=fixture('unknown');await service.verify('attempt',1000);
 const first=ledger.list('task','attempt')[0]!;
 ledger.append({...first,id:'reconciliation-proof',claim:'Provider status reconciled by host',source:{kind:'observation',observationId:'provider-status-observation'},createdAt:first.createdAt});
 send({type:'EvidenceRecorded',attemptId:'attempt',referenceId:'reconciliation-proof'});
 send({type:'ReconciliationCompleted',attemptId:'attempt',outcome:'reported-success',evidenceRefs:['reconciliation-proof']});
 const restarted=new AttemptVerificationService(kernel,ledger,registry,()=>100);
 await restarted.verify('attempt',1000);
 assert.equal(kernel.snapshot().attempts.attempt!.status,'unknown');
 assert.equal(ledger.list('task','attempt').length,3);
 assert.equal(kernel.snapshot().verifications.length,2);
});
