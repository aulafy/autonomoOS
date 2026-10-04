import test from 'node:test';
import assert from 'node:assert/strict';
import {crmConversations,crmInteractionDisplay} from '../src/crm-conversations.js';
import {parseCrmMailTrace} from '../src/crm-view.js';
import type {CrmInteraction} from '../src/crm-contract.js';
const ref='a'.repeat(32);
const row=(id:string,kind:'effect'|'gmail',gmailId='sent1',threadId='thread1'):CrmInteraction=>({id,contactId:'c',direction:'outgoing',state:'committed',summary:'Igual contenido',createdAt:1,updatedAt:2,source:kind==='gmail'?{kind:'gmail',accountRef:ref,gmailId}:{kind:'effect',effectId:id,taskId:'task'},trace:{delivery:kind==='gmail'?'gmail_imported':'gmail_verified',mail:{accountRef:ref,gmailId,threadId},observationId:kind==='gmail'?null:'observation'}});
test('exact receipt combines a synced copy once and preserves both immutable records',()=>{
 const a=row('effect','effect'),b=row('copy','gmail'),before=JSON.stringify([a,b]);
 const groups=crmConversations([b,a]);assert.equal(groups.length,1);assert.equal(groups[0]!.entries.length,1);assert.equal(groups[0]!.entries[0]!.primary.id,'effect');assert.deepEqual(groups[0]!.entries[0]!.records.map(i=>i.id),['effect','copy']);assert.equal(JSON.stringify([a,b]),before);
});
test('equal content, another account, contact, thread or Gmail id never merges records',()=>{
 for(const modify of [(b:CrmInteraction)=>{b.trace!.mail!.gmailId='sent2';},(b:CrmInteraction)=>{b.trace!.mail!.accountRef='b'.repeat(32);},(b:CrmInteraction)=>{b.contactId='other';},(b:CrmInteraction)=>{b.trace!.mail!.threadId='other-thread';}]){const a=row('effect','effect'),b=row('copy','gmail');modify(b);assert.equal(crmConversations([a,b]).flatMap(g=>g.entries).length,2);}
});
test('UNKNOWN, simulated, legacy and ambiguous effect matches are never collapsed',()=>{
 for(const delivery of ['gmail_unverified','simulation','unclassified','gmail_verified'] as const){const a=row('effect','effect'),b=row('copy','gmail');a.trace!.delivery=delivery;a.state='unknown';assert.equal(crmConversations([a,b]).flatMap(g=>g.entries).length,2);}
 const a=row('effect','effect'),a2=row('effect2','effect'),b=row('copy','gmail');assert.equal(crmConversations([a,a2,b]).flatMap(g=>g.entries).length,3);
});
test('conversation grouping uses Gmail thread within contact and account; notes stand alone',()=>{
 const a=row('a','gmail','in1'),b=row('b','gmail','sent1');a.direction='incoming';a.state='received';const c=row('c','gmail');c.trace=null as never;assert.deepEqual(crmConversations([c,b,a]).map(g=>g.entries.length).sort(),[1,2]);
});
test('client rejects malformed or inconsistent provenance instead of substituting demo data',()=>{
 const a=row('a','effect');assert.deepEqual(parseCrmMailTrace(a.trace,a.source,a.state),a.trace);
 for(const trace of [{...a.trace,observationId:null},{...a.trace,delivery:'simulation'},{...a.trace,mail:{accountRef:'invalid',gmailId:'sent1',threadId:'t'}},{...a.trace,mail:{accountRef:ref,gmailId:'sent1',threadId:'<script>'}}])assert.throws(()=>parseCrmMailTrace(trace,a.source,a.state));
 assert.throws(()=>parseCrmMailTrace(a.trace,a.source,'unknown'));
 const g=row('g','gmail');assert.throws(()=>parseCrmMailTrace({...g.trace,mail:{...g.trace!.mail,gmailId:'other'}},g.source,g.state));
});

test('committed simulation and legacy text cannot be presented as a real verified send',()=>{
 const a=row('a','effect');for(const delivery of ['simulation','unclassified','gmail_unverified'] as const){a.trace!.delivery=delivery;const displayed=crmInteractionDisplay(a);assert.notEqual(displayed.status,'Envío confirmado');assert.notEqual(displayed.summary,a.summary);}
 a.trace!.delivery='gmail_verified';assert.equal(crmInteractionDisplay(a).status,'Envío confirmado');assert.equal(crmInteractionDisplay(row('g','gmail')).status,'Correo en Enviados');a.state='unknown';assert.equal(crmInteractionDisplay(a).status,'Resultado incierto');
});
