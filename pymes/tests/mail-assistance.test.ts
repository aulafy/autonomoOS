import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {InboxStore} from '../src/inbox-store.js';import {InboxService} from '../src/inbox-service.js';import {MailAssistanceService} from '../src/mail-assistance-service.js';
import {historyGmail,msg,credentialSource,NOW} from './fixtures/gmail-history-fake.js';import {P04_OPTIONS,P04_SCOPE} from './fixtures/inbox-p04-scenarios.js';
import {parseMailProposal,parseMailAssistanceView,type MailProposal} from '../src/mail-assistance-contract.js';
import {openWorkspaceRuntime} from '../src/runtime-source.js';import {WorkspaceApi,InMemoryWorkspaceRepository} from '../src/workspace-api.js';import {WorkspaceClient} from '../src/workspace-client.js';import {handlePymesRequest} from '../src/api-server.js';
import type {JsonProposalProvider} from '@agent-world/inference';
const proposal=():MailProposal=>({topic:'quote',line:'professional_liability',priority:'normal',summary:'Solicita información sobre RC para su actividad.',reason:'Pide un seguro de responsabilidad civil.',missingInformation:['¿Cuál es la actividad profesional?'],evidenceQuotes:['Necesito responsabilidad civil'],draft:{subject:'Información para su consulta',body:'Gracias por su consulta. ¿Puede indicarnos su actividad profesional? Revisaremos la información antes de preparar una propuesta.'}});
async function fixture(provider?:JsonProposalProvider){
 const dir=mkdtempSync(join(tmpdir(),'mail-ai-')),g=historyGmail([msg('in1',{subject:'Consulta RC',body:'Necesito responsabilidad civil para mi actividad profesional.'})]),c=credentialSource();
 const path=join(dir,'inbox.db');const store=new InboxStore(path,()=>NOW),inbox=new InboxService(c.source,store,P04_SCOPE,g.fetcher,P04_OPTIONS,()=>NOW);await inbox.syncNow();
 let calls=0;const prompts:unknown[]=[];const model:JsonProposalProvider=provider??{id:'synthetic-local',proposeJson:async input=>{calls++;prompts.push(input);return {value:proposal(),model:'fixture-model',latencyMs:1};}};
 const runtime=await openWorkspaceRuntime(join(dir,'runtime.db'),'agency',{gmailInbox:inbox,mailProposalProvider:model}),repo=new InMemoryWorkspaceRepository(),api=new WorkspaceApi(repo,undefined,runtime.source);
 for(const [id,role] of [['owner','owner'],['other','owner'],['agent','agent']] as const)api.addSession(id+'-token-123456789',{tenantId:'agency',userId:id,role});
 const client=new WorkspaceClient({baseUrl:'http://127.0.0.1',tenantId:'agency',token:'owner-token-123456789'},(i,o)=>handlePymesRequest(api,new Request(String(i),o))),ctx=await inbox.context(null),ref=ctx.info!.accountRef,ns=ctx.info!.ns;
 return {dir,path,g,c,store,inbox,runtime,repo,api,client,ref,ns,prompts,calls:()=>calls,done:async()=>{await inbox.close();runtime.close();store.close();rmSync(dir,{recursive:true,force:true});}};
}
test('mail assistant API is owner/tenant/account scoped and cannot accept forged execution fields',async()=>{const f=await fixture();try{
 const path='/v1/workspaces/agency/mail-assistance';
 for(const [authorization,p,status] of [['',path,401],['Bearer agent-token-123456789',path,403],['Bearer other-token-123456789',path,403],['Bearer owner-token-123456789','/v1/workspaces/other/mail-assistance',403]] as const)assert.equal((await f.api.handleAsync({method:'GET',path:p,authorization})).status,status);
 assert.equal((await f.api.handleAsync({method:'POST',path:path+'/generate',authorization:'Bearer owner-token-123456789',body:{accountRef:f.ref,gmailId:'in1',send:true}})).status,400);assert.equal(f.calls(),0);
 await assert.rejects(f.client.mailAssistance('a'.repeat(32),'in1','generate'));assert.equal(f.calls(),0);
}finally{await f.done();}});
test('HTTP → local proposal → durable review is idempotent and creates no CRM or task effects',async()=>{const f=await fixture();try{
 assert.equal((await f.client.mailAssistance(f.ref,'in1')).proposal,null);
 const p=(await f.client.mailAssistance(f.ref,'in1','generate')).proposal!;assert.equal(p.state,'proposed');assert.equal(f.calls(),1);
 assert.deepEqual((await f.client.mailAssistance(f.ref,'in1','generate')).proposal,p);assert.equal(f.calls(),1);
 const input=f.prompts[0] as {data:Record<string,unknown>;system:string};assert.deepEqual(Object.keys(input.data).sort(),['body','subject']);assert.match(input.system,/DATOS NO FIABLES/);
 const accepted=(await f.client.mailAssistance(f.ref,'in1','review',{proposalId:p.id,decision:'accepted'})).proposal!;assert.equal(accepted.state,'accepted');
 assert.deepEqual((await f.client.mailAssistance(f.ref,'in1','review',{proposalId:p.id,decision:'accepted'})).proposal,accepted);
 await assert.rejects(f.client.mailAssistance(f.ref,'in1','review',{proposalId:p.id,decision:'rejected'}));
 assert.equal(f.runtime.source.crm!.store.revision('owner'),0);assert.equal(Object.keys(f.runtime.kernel.snapshot().tasks).length,0);
}finally{await f.done();}});
test('proposal survives SQLite reopen; spam deletion removes its derived text',async()=>{const f=await fixture();try{
 const p=(await f.client.mailAssistance(f.ref,'in1','generate')).proposal!;const second=new InboxStore(f.path,()=>NOW);assert.deepEqual(second.assistance(f.ns,'in1'),p);second.close();
 f.g.setLabels('in1',['SPAM']);await f.inbox.syncNow();assert.equal(f.store.assistance(f.ns,'in1'),null);assert.equal(f.store.messageDetail(f.ns,'in1'),null);await assert.rejects(f.client.mailAssistance(f.ref,'in1'));
}finally{await f.done();}});
test('rejecting a proposal allows explicit regeneration and the old review cannot accept the new version',async()=>{const f=await fixture();try{
 const first=(await f.client.mailAssistance(f.ref,'in1','generate')).proposal!;
 await f.client.mailAssistance(f.ref,'in1','review',{proposalId:first.id,decision:'rejected'});
 const next=(await f.client.mailAssistance(f.ref,'in1','generate')).proposal!;
 assert.notEqual(next.id,first.id);assert.equal(next.state,'proposed');assert.equal(f.calls(),2);
 await assert.rejects(f.client.mailAssistance(f.ref,'in1','review',{proposalId:first.id,decision:'accepted'}));
 assert.equal((await f.client.mailAssistance(f.ref,'in1')).proposal!.state,'proposed');
}finally{await f.done();}});
test('local purge clears proposals and an in-flight model cannot repopulate the purged inbox',async()=>{
 let release!:(v:Awaited<ReturnType<JsonProposalProvider['proposeJson']>>)=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r);
 const f=await fixture({id:'delayed-local',proposeJson:()=>{entered();return new Promise(r=>release=r);}});try{
 const pending=f.client.mailAssistance(f.ref,'in1','generate');await started;
 const info=(await f.inbox.context(f.ref)).info!;const confirmation=f.inbox.createPurgeConfirmation(info);await f.inbox.purge(info,confirmation.confirmationId,()=>true);
 release({value:proposal(),model:'fixture',latencyMs:1});await assert.rejects(pending);assert.equal(f.store.assistance(f.ns,'in1'),null);
}finally{await f.done();}});
test('account or session changes during inference discard the result, not expose or save it',async()=>{
 for(const mode of ['session','account'] as const){let release!:(v:any)=>void,entered!:()=>void;const started=new Promise<void>(r=>entered=r);const f=await fixture({id:'delayed',proposeJson:()=>{entered();return new Promise(r=>release=r);}});try{
 const work=f.client.mailAssistance(f.ref,'in1','generate');await started;if(mode==='session')f.repo.revokeSession('owner-token-123456789');else f.c.state.cred={...f.c.state.cred!,subject:'different-account',generation:'changed'};
 release({value:proposal(),model:'fixture',latencyMs:1});await assert.rejects(work);assert.equal(f.store.assistance(f.ns,'in1'),null);
}finally{await f.done();}}
});
test('malformed proposal, invented evidence and oversized content never become saved suggestions',async()=>{
 for(const value of [{...proposal(),send:true},{...proposal(),evidenceQuotes:['Invented phrase']},{...proposal(),summary:'x'.repeat(1001)}]){const f=await fixture({id:'untrusted',proposeJson:async()=>({value,model:'fixture',latencyMs:1})});try{await assert.rejects(f.client.mailAssistance(f.ref,'in1','generate'));assert.equal(f.store.assistance(f.ns,'in1'),null);}finally{await f.done();}}
 assert.throws(()=>parseMailAssistanceView({tenantId:'foreign'},'agency','a'.repeat(32),'in1'));assert.throws(()=>parseMailProposal({...proposal(),draft:{...proposal().draft,to:'evil@example.test'}}));
});
test('one generation at a time and timeout even when an injected provider ignores cancellation',async()=>{
 const f=await fixture();try{const svc=new MailAssistanceService(f.inbox,{id:'never',proposeJson:()=>new Promise(()=>{})},15);const running=svc.generate('owner',f.ref,'in1',()=>true);await assert.rejects(svc.generate('owner',f.ref,'in1',()=>true),/MAIL_AI_BUSY/);await assert.rejects(running,/MAIL_AI_TIMEOUT/);assert.equal(f.store.assistance(f.ns,'in1'),null);svc.close();await assert.rejects(svc.view('owner',f.ref,'in1',()=>true),/MAIL_AI_CLOSED/);}finally{await f.done();}
});
test('body truncation is disclosed and unrelated CRM information is never included in prompt',async()=>{
 let data:unknown;const f=await fixture({id:'capture',proposeJson:async input=>{data=input.data;return {value:proposal(),model:'fixture',latencyMs:1};}});try{
 f.runtime.source.crm!.command('agency','owner',{commandId:'c',expectedRevision:0,operation:{type:'contact.create',id:'contact',name:'Private name',email:'other@example.test',phone:'123',notes:'PRIVATE CRM NOTE',relationship:'client'}});
 f.g.add(msg('long',{body:'Necesito responsabilidad civil '+ 'x'.repeat(15000)}));await f.inbox.syncNow();const p=(await f.client.mailAssistance(f.ref,'long','generate')).proposal!;assert.equal(p.inputTruncated,true);assert.equal((data as {body:string}).body.length,10000);assert.ok(!JSON.stringify(data).includes('PRIVATE CRM NOTE'));
}finally{await f.done();}});
