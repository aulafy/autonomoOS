import test from 'node:test';import assert from 'node:assert/strict';import {fork} from 'node:child_process';import {once} from 'node:events';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {mailTaskFixture,mailTaskProposal} from './fixtures/mail-task-fixture.js';
import {parseMailTaskView,parseMailTaskInput} from '../src/mail-task-contract.js';import {gmailMime,verifyGmailRaw} from '../src/gmail-mime.js';import {validateEmailPayload,emailHash} from '../src/email-provider.js';
test('mail task API requires owner/tenant, accepted proposal, reviewed contact and exact registered address',async()=>{const f=await mailTaskFixture();try{
 const path='/v1/workspaces/agency/mail-tasks';
 for(const [token,url,status] of [['',path,401],['agent-token-123456789',path,403],['other-token-123456789',path,403],['owner-token-123456789','/v1/workspaces/other/mail-tasks',403]] as const)assert.equal((await f.api.handleAsync({method:'GET',path:url,authorization:token?'Bearer '+token:''})).status,status);
 const input=await f.prepare();assert.equal((await f.api.handleAsync({method:'POST',path,authorization:'Bearer owner-token-123456789',body:{...input,execute:true}})).status,400);
 for(const change of [{to:'evil@example.test'},{contactId:'missing'},{proposalId:'missing'}])await assert.rejects(f.client.mailTask(f.ref,'in1',{...input,...change}));
 assert.throws(()=>parseMailTaskInput({...input,recipientReviewed:false}));assert.throws(()=>parseMailTaskView({tenantId:'foreign'},'agency',f.ref,'in1'));
 assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,0);assert.equal(f.sender.counts().calls,0);
}finally{await f.done();}});
test('mail → reviewed editable draft → exact approval → C11 → CRM uses real source artifacts and no duplicate task or send',async()=>{const f=await mailTaskFixture();try{
 const input=await f.prepare(),result=await f.client.mailTask(f.ref,'in1',input),id=result.taskId!;assert.equal(result.created,true);assert.deepEqual(await f.client.mailTask(f.ref,'in1',input),{...result,created:false});assert.equal(f.calls(),1);
 await assert.rejects(f.client.mailTask(f.ref,'in1',{...input,body:'Changed input'}));assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,1);
 assert.equal(f.runtime.kernel.snapshot().tasks[id]!.planVersion,1);assert.equal(f.sender.counts().calls,0);
 const draft=await f.client.emailWorkflow(id);assert.equal(draft.review,null);assert.ok('draft' in draft&&draft.draft?.reply);assert.ok(draft.source);
 await f.client.emailWorkflow(id,'draft',{to:input.to,subject:input.subject,body:'Texto editado por el profesional.',contactId:'contact'});
 const r=await f.client.emailWorkflow(id,'review');assert.equal(r.review!.payload.body,'Texto editado por el profesional.');
 const bound=f.runtime.source.mailTasks!.store.task(id)!;assert.equal(bound.gmailId,'in1');assert.equal(bound.line,'professional_liability');assert.equal((await f.client.crm({contactId:'contact'})).leads[0]!.line,'professional_liability');
 const prep=f.runtime.kernel.snapshot();for(const u of Object.values(prep.workUnits).filter(u=>u.taskId===id).slice(0,5))assert.notEqual(prep.attempts[u.attemptIds[0]!]!.providerId,'m2-local-simulation');
 await assert.rejects(f.client.emailWorkflow(id,'execute'));await assert.rejects(f.client.emailWorkflow(id,'decision',{bindingHash:'a'.repeat(64),decision:'approved'}));assert.equal(f.sender.counts().calls,0);
 await f.client.emailWorkflow(id,'decision',{bindingHash:r.review!.bindingHash,decision:'approved'});
 const human=Object.values(f.runtime.kernel.snapshot().workUnits).find(u=>u.taskId===id&&u.id.endsWith('-s6'))!;assert.equal(f.runtime.kernel.snapshot().attempts[human.attemptIds[0]!]!.providerId,'p07-human-review');
 await f.client.emailWorkflow(id,'execute');await f.client.emailWorkflow(id,'execute');assert.equal(f.sender.counts().calls,1);assert.equal(f.runtime.kernel.snapshot().tasks[id]!.status,'completed');
 const crm=await f.client.crm({contactId:'contact'});assert.equal(crm.interactions.filter(i=>i.direction==='outgoing').length,1);assert.equal(crm.followUps.length,1);assert.equal(crm.followUps[0]!.title,input.followUpTitle);assert.equal(crm.followUps[0]!.dueAt,input.followUpDueAt);
 await f.reopen();assert.equal((await f.client.mailTask(f.ref,'in1')).taskId,id);assert.equal((await f.client.emailWorkflow(id)).status,'completed');assert.equal((await f.client.crm({contactId:'contact'})).followUps.length,1);
}finally{await f.done();}});
test('source change, identity unlink, account change or missing inbox block dispatch of an approved mail task',async()=>{
 for(const mode of ['source','contact','account','missing-inbox'] as const){const f=await mailTaskFixture();try{
  const input=await f.prepare(),id=(await f.client.mailTask(f.ref,'in1',input)).taskId!,r=await f.client.emailWorkflow(id,'review');await f.client.emailWorkflow(id,'decision',{bindingHash:r.review!.bindingHash,decision:'approved'});
  if(mode==='source'){f.g.setLabels('in1',['SPAM']);await f.inbox.syncNow();}else if(mode==='contact')await f.client.crmCommand({commandId:'unlink',expectedRevision:(await f.client.crm()).revision,operation:{type:'mail.unlink',accountRef:f.ref,gmailId:'in1'}});else if(mode==='account')f.c.state.cred={...f.c.state.cred!,subject:'other-account',generation:'changed'};else await f.reopen(false);
  await assert.rejects(f.client.emailWorkflow(id,'execute'));assert.equal(f.sender.counts().calls,0);
 }finally{await f.done();}}
});
test('ambiguous exact email is resolved only by explicit contact review',async()=>{const f=await mailTaskFixture();try{
 const input=await f.prepare();await f.client.crmCommand({commandId:'second',expectedRevision:(await f.client.crm()).revision,operation:{type:'contact.create',id:'second',name:'Second synthetic contact',email:input.to,phone:'',notes:'',relationship:'prospect'}});
 await f.client.crmLink({commandId:'human-link',expectedRevision:(await f.client.crm()).revision,accountRef:f.ref,gmailId:'in1',contactId:'contact',reviewed:true});const id=(await f.client.mailTask(f.ref,'in1',input)).taskId!;assert.equal((await f.client.emailWorkflow(id,'review')).status,'waiting_approval');
}finally{await f.done();}});
test('revoked session during mail-task creation publishes no task or saved outgoing draft',async()=>{const f=await mailTaskFixture();try{
 const input=await f.prepare(),original=f.inbox.context.bind(f.inbox);f.inbox.context=async ref=>{const ctx=await original(ref);f.repo.revokeSession('owner-token-123456789');return ctx;};await assert.rejects(f.client.mailTask(f.ref,'in1',input));assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,0);assert.equal(f.sender.counts().calls,0);
}finally{await f.done();}});
test('UNKNOWN survives restart and purge; read-only reconciliation creates follow-up exactly once without resend',async()=>{const f=await mailTaskFixture({loseResponse:true});try{
 const input=await f.prepare(),id=(await f.client.mailTask(f.ref,'in1',input)).taskId!,r=await f.client.emailWorkflow(id,'review');await f.client.emailWorkflow(id,'decision',{bindingHash:r.review!.bindingHash,decision:'approved'});
 assert.equal((await f.client.emailWorkflow(id,'execute')).status,'unknown');assert.equal((await f.client.crm({contactId:'contact'})).followUps.length,0);
 const ctx=await f.inbox.context(f.ref),challenge=f.inbox.createPurgeConfirmation(ctx.info!);await f.inbox.purge(ctx.info!,challenge.confirmationId,()=>true);await f.reopen();
 assert.equal((await f.client.emailWorkflow(id)).status,'unknown');assert.equal((await f.client.emailWorkflow(id,'execute')).status,'unknown');
 assert.equal((await f.client.emailWorkflow(id,'reconcile')).status,'completed');await f.client.emailWorkflow(id,'reconcile');assert.equal(f.sender.counts().calls,1);assert.equal((await f.client.crm({contactId:'contact'})).followUps.length,1);
}finally{await f.done();}});
test('reply metadata is exact approval material; malformed, duplicated or mismatching headers cannot prove send',()=>{
 const p=validateEmailPayload({from:'office@example.test',to:['client@example.test'],cc:[],bcc:[],subject:'Re: Consulta',body:'Texto',contactId:'c',reply:{threadId:'thread1',inReplyTo:'<parent@example.test>',references:'<older@example.test> <parent@example.test>'}}),key='a'.repeat(64),raw=gmailMime(p,key);
 assert.equal(verifyGmailRaw(Buffer.from(raw).toString('base64url'),p,key,2),true);
 for(const mutated of [raw.replace('In-Reply-To: <parent@example.test>','In-Reply-To: <other@example.test>'),raw.replace('References:','In-Reply-To: <parent@example.test>\r\nReferences:')])assert.equal(verifyGmailRaw(Buffer.from(mutated).toString('base64url'),p,key,2),false);
 assert.notEqual(emailHash(p),emailHash({...p,reply:{...p.reply!,threadId:'other'}}));
 assert.throws(()=>validateEmailPayload({...p,reply:{...p.reply!,inReplyTo:'<parent@example.test>\r\nBcc: bad@example.test'}}));
});
test('SIGKILL after durable provider acceptance preserves mail task, UNKNOWN and CRM reconciliation with one send',{timeout:20000},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mail-task-kill-'));const child=fork(new URL('./fixtures/mail-task-crash.ts',import.meta.url),[dir],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});let stderr='';child.stderr?.on('data',b=>stderr+=b);let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([once(child,'message'),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('CHILD_TIMEOUT '+stderr)),10000);child.once('exit',code=>reject(new Error('EARLY_EXIT '+code+' '+stderr)));})]);if(timer)clearTimeout(timer);const killed=once(child,'exit');child.kill('SIGKILL');await killed;
  const f=await mailTaskFixture({dir});try{const id=(await f.client.mailTask(f.ref,'in1')).taskId!;assert.ok(id);assert.equal((await f.client.emailWorkflow(id)).status,'unknown');assert.equal((await f.client.emailWorkflow(id,'reconcile')).status,'completed');assert.equal(f.sender.counts().calls,1);assert.equal((await f.client.crm({contactId:'contact'})).followUps.length,1);}finally{await f.done();}
 }finally{if(timer)clearTimeout(timer);child.kill('SIGKILL');rmSync(dir,{recursive:true,force:true});}
});

test('service enquiries create a CRM follow-up after verified send without inventing a sales opportunity',async()=>{const f=await mailTaskFixture({provider:{id:'synthetic',proposeJson:async()=>({value:{...mailTaskProposal(),topic:'service'},model:'fixture',latencyMs:1})}});try{
 const input=await f.prepare(),id=(await f.client.mailTask(f.ref,'in1',input)).taskId!,r=await f.client.emailWorkflow(id,'review');assert.equal((await f.client.crm({contactId:'contact'})).leads.length,0);await f.client.emailWorkflow(id,'decision',{bindingHash:r.review!.bindingHash,decision:'approved'});await f.client.emailWorkflow(id,'execute');const v=await f.client.crm({contactId:'contact'});assert.equal(v.leads.length,0);assert.equal(v.followUps.length,1);assert.equal(v.followUps[0]!.leadId,null);
}finally{await f.done();}});
