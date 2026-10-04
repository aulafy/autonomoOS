import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {mailTaskFixture} from './fixtures/mail-task-fixture.js';
import {MailTaskStore} from '../src/mail-task-store.js';
import {parseEmailView} from '../src/email-view.js';

async function reviewed(f:Awaited<ReturnType<typeof mailTaskFixture>>){
 const input=await f.prepare(),id=(await f.client.mailTask(f.ref,'in1',input)).taskId!;
 const view=await f.client.emailWorkflow(id,'review');return {input,id,view};
}
test('rejected mail creates a durable successor with edited payload, fresh approval and one CRM opportunity',async()=>{
 const f=await mailTaskFixture();try{
  const {input,id,view}=await reviewed(f);
  await f.client.emailWorkflow(id,'decision',{bindingHash:view.review!.bindingHash,decision:'rejected'});
  assert.equal((await f.client.emailWorkflow(id)).status,'rejected');
  const next=await f.client.reviseEmailTask(id,view.review!.bindingHash);
  assert.notEqual(next,id);assert.equal(f.runtime.kernel.snapshot().tasks[id]!.status,'cancelled');
  assert.equal((await f.client.mailTask(f.ref,'in1')).taskId,next);
  assert.equal((await f.client.mailTask(f.ref,'in1',input)).taskId,next);
  const old=await f.client.emailWorkflow(id);assert.equal(old.decision?.decision,'rejected');assert.equal(old.replacementTaskId,next);assert.equal(old.canRevise,false);
  const draft=await f.client.emailWorkflow(next);assert.equal(draft.review,null);assert.equal(draft.source?.revision,2);assert.equal(draft.source?.revisesTaskId,id);
  await assert.rejects(f.client.emailWorkflow(id,'draft',{to:input.to,subject:input.subject,body:'Forbidden old edit',contactId:input.contactId}));
  await f.client.emailWorkflow(next,'draft',{to:input.to,subject:input.subject,body:'Borrador corregido por el profesional.',contactId:input.contactId});
  const r=await f.client.emailWorkflow(next,'review');assert.notEqual(r.review!.bindingHash,view.review!.bindingHash);
  await assert.rejects(f.client.emailWorkflow(next,'execute'));
  await assert.rejects(f.client.emailWorkflow(next,'decision',{bindingHash:view.review!.bindingHash,decision:'approved'}));
  await f.client.emailWorkflow(next,'decision',{bindingHash:r.review!.bindingHash,decision:'approved'});
  await f.reopen();assert.equal((await f.client.emailWorkflow(next)).status,'approved');
  await f.client.emailWorkflow(next,'execute');await f.client.emailWorkflow(next,'execute');
  const crm=await f.client.crm({contactId:'contact'});assert.equal(crm.leads.length,1);assert.equal(crm.followUps.length,1);assert.equal(crm.followUps[0]!.leadId,crm.leads[0]!.id);assert.equal(crm.interactions.filter(i=>i.direction==='outgoing').length,1);assert.equal(f.sender.counts().calls,1);
 }finally{await f.done();}
});
test('withdrawing approved content preserves its decision but cannot reuse its approval or send the cancelled version',async()=>{
 const f=await mailTaskFixture();try{
  const {id,view}=await reviewed(f);await f.client.emailWorkflow(id,'decision',{bindingHash:view.review!.bindingHash,decision:'approved'});
  const next=await f.client.reviseEmailTask(id,view.review!.bindingHash);
  await assert.rejects(f.client.emailWorkflow(id,'execute'));
  const r=await f.client.emailWorkflow(next,'review');assert.equal(r.review!.payloadHash,view.review!.payloadHash);assert.notEqual(r.review!.bindingHash,view.review!.bindingHash);assert.equal(r.status,'waiting_approval');
  await assert.rejects(f.client.emailWorkflow(next,'execute'));assert.equal(f.sender.counts().calls,0);
  assert.equal((await f.client.emailWorkflow(id)).decision!.decision,'approved');
 }finally{await f.done();}
});
test('a C6 claim blocks revision for UNKNOWN and confirmed sends; reconciliation never creates another version',async()=>{
 for(const loseResponse of [true,false]){const f=await mailTaskFixture({loseResponse});try{
  const {id,view}=await reviewed(f);await f.client.emailWorkflow(id,'decision',{bindingHash:view.review!.bindingHash,decision:'approved'});await f.client.emailWorkflow(id,'execute');
  assert.equal((await f.client.emailWorkflow(id)).canRevise,false);await assert.rejects(f.client.reviseEmailTask(id,view.review!.bindingHash));
  if(loseResponse)await f.client.emailWorkflow(id,'reconcile');
  assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,1);assert.equal(f.sender.counts().calls,1);
 }finally{await f.done();}}
});
test('revision API rejects stale bindings, extra execution fields and other principals',async()=>{
 const f=await mailTaskFixture();try{
  const {id,view}=await reviewed(f),path=`/v1/workspaces/agency/runtime/${id}/email/revise`;
  await assert.rejects(f.client.reviseEmailTask(id,'a'.repeat(64)));
  f.repo.addSession('owner-agent-token-123456789',{tenantId:'agency',userId:'owner',role:'agent'});
  f.repo.addSession('owner-reviewer-token-123456789',{tenantId:'agency',userId:'owner',role:'reviewer'});
  for(const token of ['other-token-123456789','agent-token-123456789','owner-agent-token-123456789','owner-reviewer-token-123456789'])assert.notEqual((await f.api.handleAsync({method:'POST',path,authorization:'Bearer '+token,body:{bindingHash:view.review!.bindingHash}})).status,200);
  assert.equal((await f.api.handleAsync({method:'POST',path,authorization:'Bearer owner-token-123456789',body:{bindingHash:view.review!.bindingHash,execute:true}})).status,400);
  assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,1);assert.equal(f.sender.counts().calls,0);
 }finally{await f.done();}
});
test('source or account changes block revision without cancelling the original',async()=>{
 for(const mode of ['source','account']){const f=await mailTaskFixture();try{
  const {id,view}=await reviewed(f);if(mode==='source'){f.g.setLabels('in1',['SPAM']);await f.inbox.syncNow();}else f.c.state.cred={...f.c.state.cred!,subject:'other-account',generation:'changed'};
  await assert.rejects(f.client.reviseEmailTask(id,view.review!.bindingHash));assert.notEqual(f.runtime.kernel.snapshot().tasks[id]!.status,'cancelled');assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,1);
 }finally{await f.done();}}
});
test('session revoked during revision checks prevents cancellation and successor publication',async()=>{
 const f=await mailTaskFixture();try{
  const {id,view}=await reviewed(f),original=f.inbox.context.bind(f.inbox);
  f.inbox.context=async ref=>{const ctx=await original(ref);f.repo.revokeSession('owner-token-123456789');return ctx;};
  await assert.rejects(f.client.reviseEmailTask(id,view.review!.bindingHash));assert.notEqual(f.runtime.kernel.snapshot().tasks[id]!.status,'cancelled');assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,1);
 }finally{await f.done();}
});
test('concurrent revision requests and a retry after restart publish exactly one successor',async()=>{
 const f=await mailTaskFixture();try{
  const {id,view}=await reviewed(f);const results=await Promise.allSettled([f.client.reviseEmailTask(id,view.review!.bindingHash),f.client.reviseEmailTask(id,view.review!.bindingHash)]);
  const next=results.find((r):r is PromiseFulfilledResult<string>=>r.status==='fulfilled')!.value;
  assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,2);await f.reopen();assert.equal(await f.client.reviseEmailTask(id,view.review!.bindingHash),next);assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,2);
 }finally{await f.done();}
});
test('failure inside the revision transaction rolls back cancellation and binding on reopen',async()=>{
 const f=await mailTaskFixture();const original=MailTaskStore.prototype.bindRevision;try{
  const {id,view}=await reviewed(f);
  MailTaskStore.prototype.bindRevision=function(value){original.call(this,value);throw new Error('SYNTHETIC_TRANSACTION_FAILURE');};
  await assert.rejects(f.client.reviseEmailTask(id,view.review!.bindingHash));MailTaskStore.prototype.bindRevision=original;
  await f.reopen();assert.equal((await f.client.mailTask(f.ref,'in1')).taskId,id);assert.notEqual(f.runtime.kernel.snapshot().tasks[id]!.status,'cancelled');assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,1);assert.equal(f.sender.counts().calls,0);
 }finally{MailTaskStore.prototype.bindRevision=original;await f.done();}
});
test('a chain of rejected revisions retains history and reuses the original CRM opportunity',async()=>{
 const f=await mailTaskFixture();try{
  let {id,view}=await reviewed(f);const root=id;
  for(let n=2;n<=4;n++){
   await f.client.emailWorkflow(id,'decision',{bindingHash:view.review!.bindingHash,decision:'rejected'});
   id=await f.client.reviseEmailTask(id,view.review!.bindingHash);view=await f.client.emailWorkflow(id,'review');assert.equal(view.source?.revision,n);
  }
  assert.equal((await f.client.crm({contactId:'contact'})).leads.length,1);assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,4);assert.equal(f.runtime.kernel.snapshot().tasks[root]!.status,'cancelled');
  await f.reopen();assert.equal((await f.client.mailTask(f.ref,'in1')).taskId,id);assert.equal((await f.client.emailWorkflow(id)).status,'waiting_approval');
 }finally{await f.done();}
});
test('untrusted revision controls in API responses are rejected by the client parser',async()=>{
 const f=await mailTaskFixture();try{
  const {id}=await reviewed(f),v=await f.client.emailWorkflow(id),base={tenantId:'agency',...v};
  assert.throws(()=>parseEmailView({...base,canRevise:'yes'},'agency',id));
  assert.throws(()=>parseEmailView({...base,replacementTaskId:id},'agency',id));
  assert.throws(()=>parseEmailView({...base,review:null,canRevise:true},'agency',id));
  assert.throws(()=>parseEmailView({...base,source:{...v.source,revision:2}},'agency',id));
 }finally{await f.done();}
});
test('SIGKILL after revision retains the cancelled original and an unapproved editable successor',{timeout:20000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mail-revision-kill-')),child=fork(new URL('./fixtures/mail-revision-crash.ts',import.meta.url),[dir],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  const [data]=await Promise.race([once(child,'message'),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('REVISION_CHILD_TIMEOUT')),10000);child.once('exit',()=>reject(new Error('REVISION_CHILD_EXIT')));})]);if(timer)clearTimeout(timer);
  const {previous,next}=data as {previous:string;next:string};const killed=once(child,'exit');child.kill('SIGKILL');await killed;
  const f=await mailTaskFixture({dir});try{assert.equal(f.runtime.kernel.snapshot().tasks[previous]!.status,'cancelled');assert.equal((await f.client.mailTask(f.ref,'in1')).taskId,next);const v=await f.client.emailWorkflow(next);assert.equal(v.review,null);assert.equal(v.source?.revision,2);await assert.rejects(f.client.emailWorkflow(next,'execute'));assert.equal(f.sender.counts().calls,0);}finally{await f.done();}
 }finally{if(timer)clearTimeout(timer);child.kill('SIGKILL');rmSync(dir,{recursive:true,force:true});}
});
