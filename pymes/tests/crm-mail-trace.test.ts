import test from 'node:test'; import assert from 'node:assert/strict';
import {crmMailTraceFixture} from './fixtures/crm-mail-trace-fixture.js';
import {mailTaskFixture} from './fixtures/mail-task-fixture.js';
import {crmConversations} from '../src/crm-conversations.js';
const effects=(v:Awaited<ReturnType<Awaited<ReturnType<typeof crmMailTraceFixture>>['client']['crm']>>)=>v.interactions.filter(i=>i.source.kind==='effect');
test('Gmail receipt decorates CRM, exact synced copy groups once; projection is read-only and survives replay',async()=>{
 const f=await crmMailTraceFixture();try{const task=await f.send();let v=await f.client.crm({contactId:'contact'});assert.equal(effects(v)[0]!.trace!.delivery,'gmail_verified');assert.equal(effects(v)[0]!.trace!.mail,null);assert.ok(effects(v)[0]!.trace!.observationId);
  await f.inbox.syncNow();await f.client.crmResolve(f.ref,'sent1');v=await f.client.crm({contactId:'contact'});const snapshot=f.runtime.kernel.snapshot(),revision=v.revision;
  assert.equal(effects(v)[0]!.trace!.mail!.gmailId,'sent1');const groups=crmConversations(v.interactions);assert.equal(groups.length,1);assert.equal(groups[0]!.entries.length,2);assert.equal(groups[0]!.entries.find(e=>e.primary.source.kind==='effect')!.records.length,2);assert.equal(v.interactions.length,3);assert.equal(v.followUps.length,1);
  assert.equal((await f.client.crm({contactId:'contact'})).revision,revision);assert.deepEqual(f.runtime.kernel.snapshot(),snapshot);await f.reopen();assert.deepEqual(await f.client.crm({contactId:'contact'}),v);assert.deepEqual(f.runtime.kernel.snapshot(),snapshot);await f.client.emailWorkflow(task,'execute');assert.equal(f.calls(),1);
 }finally{await f.done();}
});
test('UNKNOWN stays uncertain despite a SENT copy; reconciliation evidence upgrades provenance without resending',async()=>{
 const f=await crmMailTraceFixture({loseResponse:true});try{const task=await f.send();await f.inbox.syncNow();await f.client.crmResolve(f.ref,'sent1');let v=await f.client.crm({contactId:'contact'});assert.equal(effects(v)[0]!.state,'unknown');assert.equal(effects(v)[0]!.trace!.delivery,'gmail_unverified');assert.equal(effects(v)[0]!.trace!.mail,null);assert.equal(crmConversations(v.interactions).flatMap(g=>g.entries).length,3);assert.equal(v.followUps.length,0);
  f.reveal();await f.client.emailWorkflow(task,'reconcile');v=await f.client.crm({contactId:'contact'});assert.equal(effects(v)[0]!.trace!.delivery,'gmail_verified');assert.equal(crmConversations(v.interactions)[0]!.entries.length,2);assert.equal(v.followUps.length,1);assert.equal(f.calls(),1);await f.reopen();assert.deepEqual(await f.client.crm({contactId:'contact'}),v);
 }finally{await f.done();}
});
test('historical provider, owner and account isolation; disconnected local history remains readable',async()=>{
 const f=await crmMailTraceFixture();try{await f.send();await f.inbox.syncNow();await f.client.crmResolve(f.ref,'sent1');const before=await f.client.crm({contactId:'contact'});await f.vault.set(f.gmail.oauth.credentialRef,JSON.stringify({...f.credential,subject:'different-account',account:'another@example.test',generation:'c'.repeat(64)}));
  const otherAccount=await f.client.crm({contactId:'contact'});assert.ok(otherAccount.interactions.every(i=>i.trace!.mail===null));assert.equal(effects(otherAccount)[0]!.trace!.delivery,'gmail_verified');
  await f.vault.delete(f.gmail.oauth.credentialRef);assert.deepEqual(await f.client.crm({contactId:'contact'}),before);
  const other=await f.api.handleAsync({method:'GET',path:'/v1/workspaces/agency/crm',authorization:'Bearer other-token-123456789'});assert.equal(other.status,200);assert.deepEqual(other.body.interactions,[]);
  const wrong=await f.api.handleAsync({method:'GET',path:'/v1/workspaces/foreign/crm',authorization:'Bearer owner-token-123456789'});assert.equal(wrong.status,403);
 }finally{await f.done();}
});
test('simulation is explicitly labeled from historical evidence and remains labeled after restart',async()=>{
 const f=await mailTaskFixture();try{const task=(await f.client.mailTask(f.ref,'in1',await f.prepare())).taskId!;const r=await f.client.emailWorkflow(task,'review');await f.client.emailWorkflow(task,'decision',{bindingHash:r.review!.bindingHash,decision:'approved'});await f.client.emailWorkflow(task,'execute');const v=await f.client.crm({contactId:'contact'});assert.equal(effects(v)[0]!.trace!.delivery,'simulation');assert.equal(effects(v)[0]!.trace!.observationId,null);await f.reopen();assert.deepEqual(await f.client.crm({contactId:'contact'}),v);
 }finally{await f.done();}
});
test('session revoked while obtaining account context produces a real authentication error',async()=>{
 const f=await crmMailTraceFixture();try{await f.send();const get=f.inbox.context.bind(f.inbox);f.inbox.context=async ref=>{const c=await get(ref);f.repo.revokeSession('owner-token-123456789');return c;};await assert.rejects(f.client.crm({contactId:'contact'}),/401|UNAUTHENTICATED/);
 }finally{await f.done();}
});
test('credential change during the CRM read invalidates the complete response',async()=>{
 const f=await crmMailTraceFixture();try{await f.send();const get=f.inbox.context.bind(f.inbox);let calls=0;f.inbox.context=async ref=>{const c=await get(ref);if(++calls===1)await f.vault.set(f.gmail.oauth.credentialRef,JSON.stringify({...f.credential,generation:'c'.repeat(64)}));return c;};await assert.rejects(f.client.crm({contactId:'contact'}),/CRM_MAIL_CHANGED/);
 }finally{await f.done();}
});
test('purging local inbox preserves journal receipt/history but removes all conversation pointers',async()=>{
 const f=await crmMailTraceFixture();try{await f.send();await f.inbox.syncNow();await f.client.crmResolve(f.ref,'sent1');const before=await f.client.crm({contactId:'contact'}),challenge=await f.client.gmailInboxPreparePurge(f.ref);await f.client.gmailInboxPurge(challenge,'BORRAR');const after=await f.client.crm({contactId:'contact'});assert.equal(after.revision,before.revision);assert.equal(after.interactions.length,before.interactions.length);assert.ok(after.interactions.every(i=>i.trace!.mail===null));assert.equal(effects(after)[0]!.trace!.delivery,'gmail_verified');assert.equal(effects(after)[0]!.trace!.observationId,effects(before)[0]!.trace!.observationId);
 }finally{await f.done();}
});
test('uncertain fake-email remains explicitly simulated, never claimed to be a Gmail send',async()=>{
 const f=await mailTaskFixture({loseResponse:true});try{const task=(await f.client.mailTask(f.ref,'in1',await f.prepare())).taskId!;const r=await f.client.emailWorkflow(task,'review');await f.client.emailWorkflow(task,'decision',{bindingHash:r.review!.bindingHash,decision:'approved'});await f.client.emailWorkflow(task,'execute');const v=await f.client.crm({contactId:'contact'});assert.equal(effects(v)[0]!.state,'unknown');assert.equal(effects(v)[0]!.trace!.delivery,'simulation');assert.equal(v.followUps.length,0);
 }finally{await f.done();}
});
