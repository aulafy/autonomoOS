import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {FilesystemWorkspace,FilesystemObserver,FilesystemReadExecutor} from '@agent-world/filesystem';
import {InMemoryResourceRegistry} from '@agent-world/resources';
import {TaskRuntimeKernel,type TaskRuntimeEvent} from '@agent-world/task-runtime';
import {EvidenceLedger} from '@agent-world/evidence-ledger';
import {recordDigest} from '@agent-world/decision-ledger';
import {fixture} from '../../control-plane/tests/helpers.js';
import {GovernedVerificationCollector,VerificationCollectionStore,decodeFilesystemVerification,DeterministicVerifier,VerifierRegistry,AttemptVerificationService,createFilesystemVerifier} from '../src/index.js';
for(const changed of [false,true])test(`C12 real file read determines ${changed?'failed':'succeeded'} despite worker success report`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'aw2-governed-file-'));
 try {
 const resources=new InMemoryResourceRegistry(),workspace=new FilesystemWorkspace(dir,resources);
 writeFileSync(join(dir,'draft.txt'),changed?'Wrong draft':'Expected draft');
 const file=workspace.registerFile({relativePath:'draft.txt'}),executor=new FilesystemReadExecutor(workspace);
 const f=await fixture({file:{parent:resources.get(workspace.directoryId)!,resource:file,executor,observer:new FilesystemObserver(workspace,resources,()=>100)}});
 const criterion={id:'digest',kind:'file' as const,resource:file.id,assertion:{digest:`sha256:${createHash('sha256').update('Expected draft').digest('hex')}`}};
 const verifier=createFilesystemVerifier({runner:f.runner,observations:f.observations,observers:f.observers,store:new VerificationCollectionStore(),now:()=>100,bindings:[{taskId:'task-1',workUnitId:'unit',attemptId:'attempt',resourceId:file.id,principalId:'astra',contractId:'contract-1',authorityLeaseId:'authority-1',resourceLeaseId:f.request.resourceLeaseId,fencingToken:f.request.fencingToken}]});
 const registry=new VerifierRegistry();registry.register(verifier);
 const kernel=new TaskRuntimeKernel();let seq=0;
 const send=(body:Record<string,unknown>)=>kernel.apply({id:`e${++seq}`,taskId:'task-1',at:100,...body} as TaskRuntimeEvent,kernel.snapshot().revision);
 send({type:'GlobalTaskCreated',goal:'Prepare draft',owner:'astra',successCriteria:[criterion]});send({type:'GlobalTaskPlanningStarted'});
 send({type:'PlanCommitted',planVersion:1,workUnits:[{id:'unit',title:'Prepare',objective:'Expected draft',dependencies:[],requiredCapabilities:[],constraints:[],expectedArtifacts:[],successCriteria:[criterion]}]});
 send({type:'AttemptCreated',workUnitId:'unit',attemptId:'attempt',providerId:'orca',actorId:'worker',dispatchFingerprint:'dispatch'});send({type:'AttemptReserved',attemptId:'attempt'});send({type:'AttemptDispatchStarted',attemptId:'attempt'});send({type:'AttemptProviderReported',attemptId:'attempt',outcome:'succeeded'});
 const ledger=new EvidenceLedger();const service=new AttemptVerificationService(kernel,ledger,registry,()=>100);
 await service.verify('attempt',100);
 assert.equal(kernel.snapshot().workUnits.unit!.status,changed?'failed':'succeeded');
 assert.equal(ledger.list('task-1','attempt')[0]!.structuredPayload && (ledger.list('task-1','attempt')[0]!.structuredPayload as Record<string,unknown>).status,changed?'unsatisfied':'satisfied');
 assert.ok(f.events.events.some(event=>event.type==='action.commit_allowed'));
 assert.equal(ledger.list('task-1','attempt')[0]!.source.kind,'verifier');
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('host file configuration rejects unbound work and unsupported content before dispatch',async()=>{
 const f=await fixture();
 const options={runner:f.runner,observations:f.observations,observers:f.observers,store:new VerificationCollectionStore(),now:()=>100};
 const verifier=createFilesystemVerifier({...options,bindings:[]});
 const input={taskId:'task-1',workUnitId:'unit',attemptId:'attempt',criterion:{id:'unbound',kind:'file' as const,resource:'file:workspace/draft.txt',assertion:{exists:true}},maxAgeMs:100};
 assert.equal((await verifier.verify(input)).status,'unknown');
 assert.equal((await verifier.verify({...input,criterion:{...input.criterion,id:'content',assertion:{contains:'private content'} as unknown as {exists:boolean}}})).status,'unknown');
 assert.equal(f.executorCalls(),0);assert.equal(f.events.events.length,0);
 const binding={taskId:'task-1',workUnitId:'unit',attemptId:'attempt',resourceId:'file:workspace/draft.txt',principalId:'astra',contractId:'contract-1',authorityLeaseId:'authority-1'};
 assert.throws(()=>createFilesystemVerifier({...options,bindings:[binding,binding]}),/INVALID_FILESYSTEM/);
 assert.throws(()=>createFilesystemVerifier({...options,bindings:[{...binding,resourceId:'/etc/passwd'}]}),/INVALID_FILESYSTEM/);
});
