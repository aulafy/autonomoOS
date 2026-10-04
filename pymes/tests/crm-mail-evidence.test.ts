import test from 'node:test';import assert from 'node:assert/strict';
import {createCrmMailTrace} from '../src/crm-mail-trace.js';import {EmailReviewStore} from '../src/email-review-store.js';import {MailTaskStore} from '../src/mail-task-store.js';
import type {CrmInteraction} from '../src/crm-contract.js';import type {EffectTransaction} from '@agent-world/effects';import type {Observation} from '@agent-world/observation';
function evidence(){
 const reviews=new EmailReviewStore(),r=reviews.propose({id:'review',taskId:'task',owner:'owner',provider:'gmail-email',planVersion:1,planHash:'a'.repeat(64),stepId:'send',at:1,payload:{from:'owner@example.test',to:['client@example.test'],cc:[],bcc:[],subject:'Test',body:'Synthetic',contactId:'contact'}});reviews.decide({id:'decision',reviewId:r.id,bindingHash:r.bindingHash,userId:'owner',at:2,decision:'approved'});
 const effect:EffectTransaction={id:'effect',taskId:'task',action:'email.send',intentId:`email:${r.bindingHash}`,executionId:'exec',parameters:r.payload,status:'committed',resourceIds:[],observationIds:['obs'],expectedPostconditionHash:'h',executorId:'email-provider',expectedPostcondition:{kind:'mail',resourceIds:[],predicate:'exists',expected:true,metadata:{}},idempotencyKey:'key',resourceFences:{},capabilityGrantIds:[],authorityLeaseIds:[],resourceLeaseIds:[],budgetReservationIds:[],createdAt:1,version:1,metadata:{}};
 const observation:Observation={id:'obs',observerId:'email-mailbox-observer',source:'provider',status:'confirmed',subject:{effectId:'effect',taskId:'task',intentId:effect.intentId,executionId:'exec',resourceIds:[]},observedAt:2,expectedPostcondition:{kind:'mail',resourceIds:[],predicate:'exists',expected:true,metadata:{}},observedResourceGenerations:{},reason:'Synthetic proof',expectedPostconditionHash:'h',evidence:[{kind:'event',reference:'gmail:sent1',metadata:{payloadHash:r.payloadHash}}],metadata:{provider:'gmail-email',simulated:false}};
 const row:CrmInteraction={id:'interaction',contactId:'contact',direction:'outgoing',state:'committed',summary:'Synthetic',createdAt:1,updatedAt:2,source:{kind:'effect',effectId:'effect',taskId:'task'}};
 const domain={effects:{get:()=>effect},reconciliations:{listDecisions:()=>[]},observations:{get:()=>observation}} as unknown as Parameters<typeof createCrmMailTrace>[3];
 const read=createCrmMailTrace('agency',reviews,new MailTaskStore(),domain);return {r,reviews,effect,observation,row,read};
}
test('unbound, unrelated, wrong-payload, non-provider and unused evidence never proves a Gmail send',()=>{
 const good=evidence();assert.equal(good.read('owner',good.row).delivery,'gmail_verified');
 const cases=[(f:ReturnType<typeof evidence>)=>{f.effect.observationIds=[];},f=>{f.effect.intentId='another-intent';},f=>{f.observation.subject.effectId='another-effect';},f=>{f.observation.subject.executionId='another-execution';},f=>{f.observation.expectedPostconditionHash='wrong';},f=>{f.observation.status='unknown';},f=>{f.observation.source='fixture';},f=>{f.observation.metadata.simulated=true;},f=>{f.observation.evidence[0]!.metadata.payloadHash='wrong';},f=>{f.observation.evidence[0]!.reference='fake-email:sent1';},f=>{f.effect.parameters={...f.r.payload,body:'changed'};},f=>{f.row.contactId='other-contact';}] satisfies ((f:ReturnType<typeof evidence>)=>void)[];
 for(const mutate of cases){const f=evidence();mutate(f);assert.notEqual(f.read('owner',f.row).delivery,'gmail_verified');}
 assert.equal(good.read('other',good.row).delivery,'unclassified');
});
test('conflicting receipts preserve uncertainty; legacy provider is not inferred from current configuration',()=>{
 const f=evidence();f.observation.evidence.push({...f.observation.evidence[0]!,reference:'gmail:sent2'});assert.equal(f.read('owner',f.row).delivery,'gmail_unverified');
 const legacy=evidence();const r=legacy.reviews.listReviews()[0]!; // A separate legacy review with no provider marker.
 const reviews=new EmailReviewStore();const {provider,payloadHash,bindingHash,...input}=r;const old=reviews.propose(input);reviews.decide({id:'decision',reviewId:old.id,bindingHash:old.bindingHash,userId:'owner',at:2,decision:'approved'});legacy.effect.intentId=`email:${old.bindingHash}`;
 const domain={effects:{get:()=>legacy.effect},reconciliations:{listDecisions:()=>[]},observations:{get:()=>legacy.observation}} as unknown as Parameters<typeof createCrmMailTrace>[3];assert.equal(createCrmMailTrace('agency',reviews,new MailTaskStore(),domain)('owner',legacy.row).delivery,'unclassified');
});
