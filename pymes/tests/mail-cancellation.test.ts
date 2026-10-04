import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {mailTaskFixture} from './fixtures/mail-task-fixture.js';import {parseEmailView} from '../src/email-view.js';
import type {MailCancelInput} from '../src/mail-cancellation-contract.js';
type Fixture=Awaited<ReturnType<typeof mailTaskFixture>>;
async function prepared(f:Fixture){const input=await f.prepare(),id=(await f.client.mailTask(f.ref,'in1',input)).taskId!;return {id,input};}
async function cancellation(f:Fixture,id:string):Promise<MailCancelInput>{const v=await f.client.emailWorkflow(id),c=v.cancellationState!;return {requestId:randomUUID(),expectedRevision:c.expectedRevision,expectedStateHash:c.expectedStateHash,reason:'Cliente ficticio pide posponer',confirmed:true};}
for(const stage of ['draft','rejected','approved'] as const)test(`cancel ${stage}: retains history and approvals; no send, outgoing CRM or sent follow-up`,async()=>{
 const f=await mailTaskFixture();try{
  const {id}=await prepared(f);if(stage!=='draft'){const r=await f.client.emailWorkflow(id,'review');await f.client.emailWorkflow(id,'decision',{bindingHash:r.review!.bindingHash,decision:stage});}
  const old=await f.client.emailWorkflow(id),crm=await f.client.crm({contactId:'contact'}),input=await cancellation(f,id),v=await f.client.cancelEmailTask(id,input);
  assert.equal(v.status,'cancelled');assert.equal(v.globalTaskStatus,'cancelled');assert.equal(v.cancellation?.actor,'owner');assert.equal(v.cancellation?.expectedRevision,1);assert.deepEqual(v.review,old.review);assert.deepEqual(v.decision,old.decision);assert.equal(v.canReprepare,true);assert.equal(v.cancellationState!.canCancel,false);
  assert.equal(v.audit.filter(a=>a.type==='job.cancelled.user').length,1);const t=f.runtime.kernel.snapshot().tasks[id]!;assert.ok(f.runtime.kernel.snapshot().references.some(r=>r.taskId===id&&r.kind==='decision'&&r.id===v.cancellation!.id));assert.ok(f.runtime.kernel.snapshot().references.some(r=>r.taskId===id&&r.kind==='evidence'&&r.id===v.cancellation!.id+':evidence'));
  for(const op of ['review','execute'] as const)await assert.rejects(f.client.emailWorkflow(id,op));
  await assert.rejects(f.client.emailWorkflow(id,'draft',{to:'cliente@example.test',subject:'x',body:'x',contactId:'contact'}));
  assert.equal(f.sender.counts().calls,0);const after=await f.client.crm({contactId:'contact'});assert.deepEqual(after.leads,crm.leads);assert.deepEqual(after.interactions,crm.interactions);assert.deepEqual(after.followUps,crm.followUps);
 }finally{await f.done();}
});
test('cancel is idempotent across restart/replay, immutable on conflicting request or altered reason',async()=>{
 const f=await mailTaskFixture();try{const {id}=await prepared(f),input=await cancellation(f,id),v=await f.client.cancelEmailTask(id,input),state=f.runtime.kernel.snapshot();
  assert.deepEqual(await f.client.cancelEmailTask(id,input),v);assert.deepEqual(f.runtime.kernel.snapshot(),state);
  await f.reopen();assert.deepEqual(await f.client.cancelEmailTask(id,input),v);assert.deepEqual(f.runtime.kernel.snapshot(),state);
  await assert.rejects(f.client.cancelEmailTask(id,{...input,reason:'Otra razón'}));await assert.rejects(f.client.cancelEmailTask(id,{...input,requestId:randomUUID()}));
  assert.equal(f.sender.counts().calls,0);
 }finally{await f.done();}
});
test('stale preview after draft or approval change cannot cancel; revision mismatch cannot cancel',async()=>{
 for(const mode of ['draft','approval','revision']){const f=await mailTaskFixture();try{
  const {id,input}=await prepared(f),preview=await cancellation(f,id);
  if(mode==='draft')await f.client.emailWorkflow(id,'draft',{to:input.to,subject:input.subject,body:'Contenido modificado',contactId:input.contactId});
  if(mode==='approval'){const r=await f.client.emailWorkflow(id,'review');await f.client.emailWorkflow(id,'decision',{bindingHash:r.review!.bindingHash,decision:'approved'});}
  await assert.rejects(f.client.cancelEmailTask(id,mode==='revision'?{...preview,expectedRevision:2}:preview),/EMAIL_CANCEL_STALE/);assert.notEqual(f.runtime.kernel.snapshot().tasks[id]!.status,'cancelled');
 }finally{await f.done();}}
});
for(const loseResponse of [false,true])test(`C6 claim blocks cancellation (${loseResponse?'unknown':'committed'}), no claim/evidence changes`,async()=>{
 const f=await mailTaskFixture({loseResponse});try{const {id}=await prepared(f),preview=await cancellation(f,id),r=await f.client.emailWorkflow(id,'review');await f.client.emailWorkflow(id,'decision',{bindingHash:r.review!.bindingHash,decision:'approved'});await f.client.emailWorkflow(id,'execute');
  const before=await f.client.emailWorkflow(id),state=f.runtime.kernel.snapshot();assert.equal(before.cancellationState!.blockedReason,'EMAIL_CANCEL_C6_CLAIM');assert.equal(before.effects[0]!.status,loseResponse?'unknown':'committed');
  await assert.rejects(f.client.cancelEmailTask(id,preview),/EMAIL_CANCEL_C6_CLAIM/);assert.deepEqual(await f.client.emailWorkflow(id),before);assert.deepEqual(f.runtime.kernel.snapshot(),state);
  if(loseResponse)await f.client.emailWorkflow(id,'reconcile');assert.equal(f.sender.counts().calls,1);
 }finally{await f.done();}
});
test('even a failed C6 claim blocks cancellation before any provider call',async()=>{
 const f=await mailTaskFixture({emailHooks:{beforeDispatch:()=>{throw new Error('SYNTHETIC_BEFORE_POST');}}});try{const {id}=await prepared(f),p=await cancellation(f,id),r=await f.client.emailWorkflow(id,'review');await f.client.emailWorkflow(id,'decision',{bindingHash:r.review!.bindingHash,decision:'approved'});await f.client.emailWorkflow(id,'execute').catch(()=>null);
  assert.equal((await f.client.emailWorkflow(id)).cancellationState!.blockedReason,'EMAIL_CANCEL_C6_CLAIM');await assert.rejects(f.client.cancelEmailTask(id,p),/EMAIL_CANCEL_C6_CLAIM/);assert.equal(f.sender.counts().calls,0);
 }finally{await f.done();}
});
for(const stage of ['created','dispatching','unknown','failed'] as const)test(`durable ${stage} attempt blocks cancellation without relying on UI or C6`,async()=>{
 const f=await mailTaskFixture();try{const {id}=await prepared(f),p=await cancellation(f,id),k=f.runtime.kernel,unit=Object.values(k.snapshot().workUnits).find(u=>u.taskId===id&&u.status==='ready')!,at=k.snapshot().tasks[id]!.updatedAt;
  const apply=(e:Record<string,unknown>)=>k.apply({id:randomUUID(),taskId:id,at,...e} as Parameters<typeof k.apply>[0],k.snapshot().revision);
  apply({type:'AttemptCreated',attemptId:'external-attempt',workUnitId:unit.id,providerId:'external-fixture',actorId:'actor',dispatchFingerprint:'synthetic'});
  if(stage!=='created'){apply({type:'AttemptReserved',attemptId:'external-attempt'});apply({type:'AttemptDispatchStarted',attemptId:'external-attempt'});}
  if(stage==='unknown')apply({type:'AttemptUnknown',attemptId:'external-attempt'});
  if(stage==='failed'){apply({type:'EvidenceRecorded',referenceId:'synthetic-evidence',attemptId:'external-attempt'});apply({type:'AttemptProviderReported',attemptId:'external-attempt',outcome:'failed'});apply({type:'VerificationStarted',attemptId:'external-attempt'});apply({type:'VerificationCompleted',attemptId:'external-attempt',results:unit.successCriteria.map(c=>({criterionId:c.id,status:'unsatisfied',evidenceRefs:['synthetic-evidence']}))});}
  const state=k.snapshot(),v=await f.client.emailWorkflow(id);assert.equal(v.cancellationState!.canCancel,false);await assert.rejects(f.client.cancelEmailTask(id,p));assert.deepEqual(k.snapshot(),state);assert.equal(f.sender.counts().calls,0);
  if(stage==='failed')assert.equal(v.cancellationState!.blockedReason,'EMAIL_CANCEL_EXTERNAL_DISPATCH');if(stage==='unknown')assert.equal(v.cancellationState!.blockedReason,'EMAIL_CANCEL_UNKNOWN');
 }finally{await f.done();}
});
test('cancel API isolates tenants/owners/roles and requires explicit strict confirmation',async()=>{
 const f=await mailTaskFixture();try{const {id}=await prepared(f),body=await cancellation(f,id),path=`/v1/workspaces/agency/runtime/${id}/email/cancel`;
  f.repo.addSession('owner-reviewer-token-123456789',{tenantId:'agency',userId:'owner',role:'reviewer'});f.repo.addSession('owner-agent-token-123456789',{tenantId:'agency',userId:'owner',role:'agent'});
  for(const token of ['other-token-123456789','agent-token-123456789','owner-reviewer-token-123456789','owner-agent-token-123456789'])assert.notEqual((await f.api.handleAsync({method:'POST',path,authorization:'Bearer '+token,body})).status,200);
  assert.equal((await f.api.handleAsync({method:'POST',path:path.replace('/agency/','/other/'),authorization:'Bearer owner-token-123456789',body})).status,403);
  for(const bad of [{...body,confirmed:false},{...body,execute:true},{...body,expectedRevision:0}])assert.equal((await f.api.handleAsync({method:'POST',path,authorization:'Bearer owner-token-123456789',body:bad})).status,400);
  assert.notEqual(f.runtime.kernel.snapshot().tasks[id]!.status,'cancelled');
 }finally{await f.done();}
});
test('session revoked between preview and transaction is rejected before any mutation',async()=>{
 let revoke=()=>{};const f=await mailTaskFixture({cancellationHooks:{beforePersist:()=>revoke()}});try{const {id}=await prepared(f),p=await cancellation(f,id);revoke=()=>f.repo.revokeSession('owner-token-123456789');await assert.rejects(f.client.cancelEmailTask(id,p));assert.notEqual(f.runtime.kernel.snapshot().tasks[id]!.status,'cancelled');}finally{await f.done();}
});
test('lost response after commit retries the same decision without new events',async()=>{
 let once=true;const f=await mailTaskFixture({cancellationHooks:{afterPersist:()=>{if(once){once=false;throw new Error('LOST_LOCAL_RESPONSE');}}}});try{const {id}=await prepared(f),p=await cancellation(f,id);await assert.rejects(f.client.cancelEmailTask(id,p));const state=f.runtime.kernel.snapshot();const v=await f.client.cancelEmailTask(id,p);assert.equal(v.status,'cancelled');assert.deepEqual(f.runtime.kernel.snapshot(),state);assert.equal(v.audit.filter(a=>a.type==='job.cancelled.user').length,1);}finally{await f.done();}
});
for(const reviewed of [false,true])test(`same-email reprepare is explicit and new (${reviewed?'existing CRM opportunity':'no previous CRM preparation'})`,async()=>{
 const f=await mailTaskFixture();try{const {id,input}=await prepared(f);if(reviewed){const r=await f.client.emailWorkflow(id,'review');await f.client.emailWorkflow(id,'decision',{bindingHash:r.review!.bindingHash,decision:'approved'});}
  const old=await f.client.cancelEmailTask(id,await cancellation(f,id)),task=f.runtime.kernel.snapshot().tasks[id]!;
  assert.equal((await f.client.mailTask(f.ref,'in1',input)).taskId,id);assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,1);
  const next=await f.client.reprepareEmailTask(id,old.cancellation!.id);assert.notEqual(next,id);assert.equal(await f.client.reprepareEmailTask(id,old.cancellation!.id),next);assert.deepEqual(f.runtime.kernel.snapshot().tasks[id],task);
  const v=await f.client.emailWorkflow(next);assert.equal(v.source!.revision,2);assert.equal(v.source!.gmailId,'in1');assert.equal(v.review,null);assert.equal(v.decision,null);assert.equal(v.cancellation,null);assert.equal(v.source!.revisesTaskId,id);
  await assert.rejects(f.client.emailWorkflow(next,'execute'));const r=await f.client.emailWorkflow(next,'review');await assert.rejects(f.client.emailWorkflow(next,'execute'));await f.client.emailWorkflow(next,'decision',{bindingHash:r.review!.bindingHash,decision:'approved'});await f.client.emailWorkflow(next,'execute');
  const crm=await f.client.crm({contactId:'contact'});assert.equal(crm.leads.length,1);assert.equal(crm.interactions.filter(i=>i.direction==='outgoing').length,1);assert.equal(crm.followUps.length,1);assert.equal(f.sender.counts().calls,1);
  await f.reopen();assert.deepEqual((await f.client.emailWorkflow(id)).cancellation,old.cancellation);assert.equal((await f.client.emailWorkflow(next)).status,'completed');
 }finally{await f.done();}
});
test('reprepare chain skips unprepared ancestors and reuses the nearest existing opportunity',async()=>{
 const f=await mailTaskFixture();try{let {id}=await prepared(f);await f.client.emailWorkflow(id,'review');for(let n=0;n<3;n++){const v=await f.client.cancelEmailTask(id,await cancellation(f,id));id=await f.client.reprepareEmailTask(id,v.cancellation!.id);}await f.client.emailWorkflow(id,'review');assert.equal((await f.client.crm({contactId:'contact'})).leads.length,1);await f.reopen();assert.equal((await f.client.emailWorkflow(id)).source!.revision,4);}finally{await f.done();}
});
test('client rejects malformed/cross-task cancellation controls',async()=>{
 const f=await mailTaskFixture();try{const {id}=await prepared(f),v=await f.client.emailWorkflow(id),base={tenantId:'agency',...v};for(const patch of [{canReprepare:true},{cancellationState:{...v.cancellationState,expectedStateHash:'bad'}},{cancellationState:{...v.cancellationState,canCancel:true,blockedReason:'EMAIL_CANCEL_C6_CLAIM'}}])assert.throws(()=>parseEmailView({...base,...patch},'agency',id));const c=await f.client.cancelEmailTask(id,await cancellation(f,id));assert.throws(()=>parseEmailView({tenantId:'agency',...c,cancellation:{...c.cancellation,taskId:'other'}},'agency',id));}finally{await f.done();}
});
test('concurrent identical cancellation requests yield one decision and cross-job request reuse conflicts',async()=>{
 const f=await mailTaskFixture();try{const {id}=await prepared(f),input=await cancellation(f,id),results=await Promise.all([f.client.cancelEmailTask(id,input),f.client.cancelEmailTask(id,input)]);assert.equal(results[0].cancellation!.id,results[1].cancellation!.id);assert.equal(results[0].audit.filter(a=>a.type==='job.cancelled.user').length,1);const next=await f.client.reprepareEmailTask(id,results[0].cancellation!.id),p=await cancellation(f,next);await assert.rejects(f.client.cancelEmailTask(next,{...p,requestId:input.requestId}),/EMAIL_CANCEL_REQUEST_CONFLICT/);assert.notEqual(f.runtime.kernel.snapshot().tasks[next]!.status,'cancelled');}finally{await f.done();}
});
test('disconnecting/changing the inbox credential does not prevent safe local cancellation',async()=>{
 const f=await mailTaskFixture();try{const {id}=await prepared(f),p=await cancellation(f,id);f.c.state.cred=null;const v=await f.client.cancelEmailTask(id,p);assert.equal(v.status,'cancelled');await assert.rejects(f.client.reprepareEmailTask(id,v.cancellation!.id));assert.equal(f.sender.counts().calls,0);}finally{await f.done();}
});

test('read-only role sees no cancellation or reprepare permission even for its own user id',async()=>{
 const f=await mailTaskFixture();try{const {id}=await prepared(f);f.repo.addSession('owner-reader-token-123456789',{tenantId:'agency',userId:'owner',role:'reviewer'});const path=`/v1/workspaces/agency/runtime/${id}/email`,read=await f.api.handleAsync({method:'GET',path,authorization:'Bearer owner-reader-token-123456789'});assert.equal(read.status,200);const state=read.body.cancellationState as {canCancel:boolean;blockedReason:string};assert.equal(state.canCancel,false);assert.equal(state.blockedReason,'EMAIL_CANCEL_PERMISSION_DENIED');assert.equal(read.body.canReprepare,false);await f.client.cancelEmailTask(id,await cancellation(f,id));const after=await f.api.handleAsync({method:'GET',path,authorization:'Bearer owner-reader-token-123456789'});assert.equal(after.body.canReprepare,false);assert.ok(after.body.cancellation);}finally{await f.done();}
});
