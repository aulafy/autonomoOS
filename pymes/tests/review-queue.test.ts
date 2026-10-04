import test from 'node:test';
import assert from 'node:assert/strict';
import {ReviewService,ReviewCursorError} from '../src/review-service.js';
import {EmailReviewStore} from '../src/email-review-store.js';
import {MailTaskStore} from '../src/mail-task-store.js';
import {parseReviewQuery,parseReviewPage,REVIEW_STATES} from '../src/review-contract.js';
import type {TaskRuntimeState} from '@agent-world/task-runtime';
import {mailTaskFixture} from './fixtures/mail-task-fixture.js';
import {WorkspaceClient} from '../src/workspace-client.js';
const payload={from:'office@example.test',to:['client@example.test'],cc:[],bcc:[],subject:'Consulta',body:'PRIVATE_BODY_NEVER_IN_QUEUE',contactId:'contact'};
function projection(){
 const state:TaskRuntimeState={revision:0,tasks:{},workUnits:{},attempts:{},plans:[],verifications:[],references:[]},reviews=new EmailReviewStore(),bindings=new MailTaskStore(),effects:{taskId:string;effective:string;status:string}[]=[];
 const task=(id:string,status:TaskRuntimeState['tasks'][string]['status']='created',owner='owner',goal='Consulta de seguro')=>{state.tasks[id]={id,goal,owner,status,successCriteria:[],workUnitIds:[],planVersion:1,createdAt:1,updatedAt:2};};
 const review=(id:string,decision?:'approved'|'rejected')=>{const r=reviews.propose({id:'review-'+id,taskId:id,owner:'owner',planVersion:1,planHash:'a'.repeat(64),stepId:'step',at:3,payload});if(decision)reviews.decide({id:'decision-'+id,reviewId:r.id,userId:'owner',decision,bindingHash:r.bindingHash,at:4});return r;};
 return {state,reviews,bindings,effects,task,review,service:new ReviewService('agency',()=>structuredClone(state),reviews,bindings,()=>effects,'test',()=>null)};
}
test('queue derives durable states, prioritizes UNKNOWN and never exports mail bodies or recipient addresses',()=>{
 const f=projection();for(const s of REVIEW_STATES)f.task(s);
 f.review('approval');f.review('ready','approved');f.review('rejected','rejected');f.state.tasks.blocked!.status='blocked';f.state.tasks.running!.status='running';f.state.tasks.failed!.status='failed';f.state.tasks.completed!.status='completed';f.state.tasks.cancelled!.status='cancelled';f.effects.push({taskId:'uncertain',effective:'unknown',status:'unknown'});
 f.task('other','created','other','HIDDEN_OTHER_OWNER');const q=parseReviewQuery({filter:'all'}),p=f.service.list('owner',q);
 assert.equal(p.items[0]!.taskId,'uncertain');assert.equal(p.total,10);for(const s of REVIEW_STATES)assert.equal(p.items.find(r=>r.taskId===s)!.status,s);
 const text=JSON.stringify(p);for(const secret of [payload.body,payload.to[0]!,payload.from,'HIDDEN_OTHER_OWNER','bindingHash','draftHash'])assert(!text.includes(secret));
 assert.deepEqual(parseReviewPage(p,'agency',q),p);assert.equal(f.service.list('owner',parseReviewQuery({})).matchedTotal,8);
});
test('confirmed email is not a completed workflow until CRM and followup steps complete',()=>{
 const f=projection();f.task('post-email','blocked');f.effects.push({taskId:'post-email',effective:'committed',status:'committed'});
 assert.equal(f.service.list('owner',parseReviewQuery({})).items[0]!.status,'blocked');f.state.tasks['post-email']!.status='running';assert.equal(f.service.list('owner',parseReviewQuery({})).items[0]!.status,'running');f.state.tasks['post-email']!.status='completed';assert.equal(f.service.list('owner',parseReviewQuery({filter:'all'})).items[0]!.status,'completed');
});
test('pagination covers more than fifty jobs once, scopes cursor to owner/filter/search/page size and rejects changed facts',()=>{
 const f=projection();for(let i=0;i<63;i++)f.task('task-'+String(i).padStart(3,'0'),'created','owner',i%2?'Póliza José':'Consulta');
 const q=parseReviewQuery({filter:'all',limit:25}),p=f.service.list('owner',q),second=f.service.list('owner',{...q,cursor:p.nextCursor}),third=f.service.list('owner',{...q,cursor:second.nextCursor});
 assert.equal(new Set([...p.items,...second.items,...third.items].map(r=>r.taskId)).size,63);assert.equal(third.nextCursor,null);
 for(const query of [{...q,filter:'draft' as const},{...q,query:'jose'},{...q,limit:20}])assert.throws(()=>f.service.list('owner',{...query,cursor:p.nextCursor}),ReviewCursorError);
 assert.throws(()=>f.service.list('other',{...q,cursor:p.nextCursor}),ReviewCursorError);
 assert.equal(f.service.list('owner',parseReviewQuery({query:'poliza JOSE'})).matchedTotal,31);
 f.reviews.saveDraft({taskId:p.items[0]!.taskId,owner:'owner',at:5,payload});assert.throws(()=>f.service.list('owner',{...q,cursor:p.nextCursor}),ReviewCursorError);
 assert.throws(()=>f.service.list('owner',{...q,cursor:'eyJ2IjoxfQ'}),ReviewCursorError);
});
test('client contract rejects wrong scopes, duplicate jobs, unrequested states and malformed queries',()=>{
 const f=projection();f.task('one');const q=parseReviewQuery({filter:'draft'}),p=f.service.list('owner',q);
 assert.throws(()=>parseReviewPage(p,'other',q));assert.throws(()=>parseReviewPage({...p,items:[p.items[0],p.items[0]]},'agency',q));assert.throws(()=>parseReviewPage({...p,items:[{...p.items[0],status:'completed'}]},'agency',q));
 for(const raw of [{filter:{}},{filter:['draft']},{query:'x\n'},{limit:51},{limit:1.5},{cursor:'='},{owner:'other'}])assert.throws(()=>parseReviewQuery(raw));
});
test('real API groups durable revisions and reads queue without inference, Gmail requests, CRM changes or dispatch',async()=>{
 const f=await mailTaskFixture();try{
  const input=await f.prepare(),id=(await f.client.mailTask(f.ref,'in1',input)).taskId!,review=await f.client.emailWorkflow(id,'review');
  assert.equal((await f.client.reviewQueue()).items[0]!.status,'approval');await f.client.emailWorkflow(id,'decision',{bindingHash:review.review!.bindingHash,decision:'rejected'});assert.equal((await f.client.reviewQueue()).items[0]!.status,'rejected');
  const next=await f.client.reviseEmailTask(id,review.review!.bindingHash),before=f.runtime.kernel.snapshot(),crm=await f.client.crm(),calls=f.calls();
  let remoteReads=0;const original=f.inbox.context.bind(f.inbox);f.inbox.context=async ref=>{remoteReads++;return original(ref);};
  const page=await f.client.reviewQueue({filter:'all'});assert.equal(page.total,1);assert.equal(page.items[0]!.taskId,next);assert.equal(page.items[0]!.revision,2);assert.equal(page.items[0]!.contactName,'Cliente ficticio');assert.equal(page.items[0]!.delivery,'test');assert.equal(page.items[0]!.status,'draft');
  assert.equal(remoteReads,0);assert.equal(f.calls(),calls);assert.equal(f.sender.counts().calls,0);assert.deepEqual(f.runtime.kernel.snapshot(),before);assert.deepEqual(await f.client.crm(),crm);
  await f.reopen(false);assert.deepEqual(await f.client.reviewQueue({filter:'all'}),page);
 }finally{await f.done();}
});
test('API isolates tenant/owner and rejects unauthenticated, unauthorized, duplicated or unknown arguments',async()=>{
 const f=await mailTaskFixture();try{
  f.runtime.source.createTask!('agency','owner',{id:'own',goal:'Private owner title'});f.runtime.source.createTask!('agency','other',{id:'other',goal:'Other private title'});
  const request=(path:string,token?:string,method='GET')=>f.api.handleAsync({method:method as 'GET',path,authorization:token?'Bearer '+token:undefined});
  const path='/v1/workspaces/agency/review-queue';assert.equal((await request(path)).status,401);
  f.repo.addSession('worker-token-123456789',{tenantId:'agency',userId:'owner',role:'worker'});assert.equal((await request(path,'worker-token-123456789')).status,403);assert.equal((await request('/v1/workspaces/foreign/review-queue','owner-token-123456789')).status,403);
  const own=await f.client.reviewQueue();assert.deepEqual(own.items.map(r=>r.taskId),['own']);const other=await request(path,'other-token-123456789');assert(!JSON.stringify(other).includes('Private owner title'));
  for(const suffix of ['?limit=0','?limit=25&limit=20','?owner=other','?filter=bad','?query=%00'])assert.equal((await request(path+suffix,'owner-token-123456789')).status,400);
  assert.equal((await request(path,'owner-token-123456789','POST')).status,405);assert.equal((await request(path+'/other','owner-token-123456789')).status,405);
 }finally{await f.done();}
});
test('UNKNOWN stays visible after restart and reconciliation never dispatches a duplicate',async()=>{
 const f=await mailTaskFixture({loseResponse:true});try{
  const input=await f.prepare(),id=(await f.client.mailTask(f.ref,'in1',input)).taskId!,review=await f.client.emailWorkflow(id,'review');await f.client.emailWorkflow(id,'decision',{bindingHash:review.review!.bindingHash,decision:'approved'});assert.equal((await f.client.reviewQueue()).items[0]!.status,'ready');await f.client.emailWorkflow(id,'execute');
  await f.reopen();assert.equal((await f.client.reviewQueue()).items[0]!.status,'uncertain');await f.client.emailWorkflow(id,'reconcile');const p=await f.client.reviewQueue({filter:'all'});assert.equal(p.items[0]!.status,'completed');assert.equal(f.sender.counts().calls,1);
 }finally{await f.done();}
});
test('exact task read opens a selected job outside the first fifty and rejects foreign or forged task responses',async()=>{
 const f=await mailTaskFixture();try{
  for(let i=0;i<62;i++)f.runtime.source.createTask!('agency','owner',{id:'task-'+String(i).padStart(3,'0'),goal:'Consulta '+i});f.runtime.source.createTask!('agency','other',{id:'foreign',goal:'Private'});
  const view=await f.client.runtimeView();assert.equal(view.tasks.length,50);const outside=Object.keys(f.runtime.kernel.snapshot().tasks).find(id=>id!=='foreign'&&!view.tasks.some(t=>t.id===id))!;
  assert.equal((await f.client.runtimeView(outside)).tasks[0]!.id,outside);await assert.rejects(f.client.runtimeView('foreign'));
  const forged=new WorkspaceClient({baseUrl:'http://127.0.0.1',tenantId:'agency',token:'owner-token-123456789'},async()=>Response.json({tenantId:'agency',...await f.client.runtimeView(view.tasks[0]!.id)}));await assert.rejects(forged.runtimeView(outside));
 }finally{await f.done();}
});

test('API reports a changed cursor and unavailable journal explicitly; it never substitutes a demo queue',async()=>{
 const f=await mailTaskFixture();try{
  for(let i=0;i<26;i++)f.runtime.source.createTask!('agency','owner',{id:'cursor-'+i,goal:'Consulta '+i});const page=await f.client.reviewQueue();assert(page.nextCursor);
  f.runtime.source.createTask!('agency','owner',{id:'changed',goal:'Nueva consulta'});const r=await f.api.handleAsync({method:'GET',path:'/v1/workspaces/agency/review-queue?cursor='+page.nextCursor,authorization:'Bearer owner-token-123456789'});assert.equal(r.status,409);assert.equal(r.body.error,'REVIEW_CURSOR_STALE');
  f.runtime.close();const unavailable=await f.api.handleAsync({method:'GET',path:'/v1/workspaces/agency/review-queue',authorization:'Bearer owner-token-123456789'});assert.equal(unavailable.status,503);assert.deepEqual(unavailable.body,{error:'REVIEW_NOT_AVAILABLE'});
 }finally{await f.done();}
});
test('registered approval is blocked when its plan version has changed',()=>{
 const f=projection();f.task('stale');f.review('stale','approved');f.state.tasks.stale!.planVersion=2;assert.equal(f.service.list('owner',parseReviewQuery({})).items[0]!.status,'blocked');
});
