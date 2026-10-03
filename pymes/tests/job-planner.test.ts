import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {InferenceProvider,PlanContext,ProposedPlan} from '@agent-world/inference';
import {openWorkspaceRuntime} from '../src/runtime-source.js';
import {WorkspaceApi,InMemoryWorkspaceRepository} from '../src/workspace-api.js';
import {handlePymesRequest} from '../src/api-server.js';

const actions=['email.identify_contact','crm.lookup_contact','crm.propose_lead','email.classify','email.draft_reply','email.review_reply','email.send_reply','crm.record_interaction','crm.create_followup'];
const targets=['email.incoming','crm.local','crm.local','email.incoming','email.reply','email.reply','email.reply','crm.local','crm.local'];
function proposal():ProposedPlan{return {actions:actions.map((action,i)=>({action,targetId:targets[i],parameters:{}}))} as ProposedPlan;}
function provider(run:(context:PlanContext)=>Promise<ProposedPlan>|ProposedPlan):InferenceProvider{return {id:'local-test',capabilities:async()=>['structured_output'],health:async()=>({ok:true,provider:'local-test',endpoint:'http://127.0.0.1:8080',authConfigured:false}),proposePlan:async c=>({plan:await run(c),rawText:'not persisted',latencyMs:1})};}
async function fixture(p:InferenceProvider,timeout=30_000){
 const dir=mkdtempSync(join(tmpdir(),'autonomo-plan-')),path=join(dir,'runtime.db');
 const runtime=await openWorkspaceRuntime(path,'agency',{provider:p,planningTimeoutMs:timeout});
 runtime.source.createTask!('agency','owner',{id:'job',goal:'Atender una consulta de cliente'});
 const repository=new InMemoryWorkspaceRepository();repository.addSession('owner-token-123456',{userId:'owner',tenantId:'agency',role:'owner'});repository.addSession('other-token-123456',{userId:'other',tenantId:'agency',role:'owner'});repository.addSession('worker-token-12345',{userId:'worker',tenantId:'agency',role:'worker'});
 const api=new WorkspaceApi(repository,undefined,runtime.source);
 const post=(token='owner-token-123456',body:unknown={workflow:'email-lead-v1'},tenant='agency')=>handlePymesRequest(api,new Request(`http://localhost/v1/workspaces/${tenant}/runtime/job/plan`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)}));
 return {dir,path,runtime,repository,post,cleanup:()=>{runtime.close();rmSync(dir,{recursive:true,force:true});}};
}

test('email plan uses existing local provider, persists host-owned DAG and survives reopen without replaying inference',async()=>{
 let calls=0;const f=await fixture(provider(c=>{calls++;assert.equal(c.availableActions.length,9);assert.equal(c.entities.length,3);return proposal();}));
 try{
  assert.equal((await f.post()).status,201);
  const state=f.runtime.kernel.snapshot(),task=state.tasks.job!;
  assert.equal(task.planVersion,1);assert.equal(task.status,'ready');assert.equal(task.workUnitIds.length,9);
  assert.equal(Object.keys(state.attempts).length,0);assert.equal(state.references.length,0);
  const review=state.workUnits['job-p1-s6']!;assert.equal(review.successCriteria[0]!.kind,'human-approval');
  assert.deepEqual(state.workUnits['job-p1-s7']!.dependencies,['job-p1-s6']);
  assert.equal((await f.post()).status,200);assert.equal(calls,1);
  f.runtime.close();const restored=await openWorkspaceRuntime(f.path,'agency',{provider:provider(()=>{throw new Error('must not run');})});
  try{assert.deepEqual(restored.kernel.snapshot(),state);assert.deepEqual(await restored.source.planTask!('agency','owner',{taskId:'job',workflow:'email-lead-v1'}),{created:false,planVersion:1});}finally{restored.close();}
 }finally{f.cleanup();}
});

test('planning rejects missing auth, foreign owner/tenant, worker and extra authority before inference',async()=>{
 let calls=0;const f=await fixture(provider(()=>{calls++;return proposal();}));
 try{
  assert.equal((await f.post('bad')).status,401);assert.equal((await f.post('other-token-123456')).status,404);
  assert.equal((await f.post('worker-token-12345')).status,403);assert.equal((await f.post('owner-token-123456',{workflow:'email-lead-v1'},'foreign')).status,403);
  assert.equal((await f.post('owner-token-123456',{workflow:'email-lead-v1',approved:true})).status,400);
  assert.equal(calls,0);assert.equal(f.runtime.kernel.snapshot().tasks.job!.status,'created');
 }finally{f.cleanup();}
});

for(const [name,mutate] of [
 ['URL',(p:ProposedPlan)=>{p.actions[6]!.parameters={url:'https://evil.example',recipient:'attacker'};}],
 ['skip review',(p:ProposedPlan)=>{p.actions.splice(5,1);}],
 ['reorder send',(p:ProposedPlan)=>{[p.actions[5],p.actions[6]]=[p.actions[6]!,p.actions[5]!];}],
 ['resource',(p:ProposedPlan)=>{p.actions[0]!.targetId='crm.other-client';}],
 ['invent approval',(p:ProposedPlan)=>{Object.assign(p.actions[5]!,{approved:true});}]
] as const){test(`untrusted model ${name} cannot alter journal or authority`,async()=>{
 const f=await fixture(provider(()=>{const p=proposal();mutate(p);return p;}));
 try{const before=f.runtime.kernel.snapshot();assert.equal((await f.post()).status,400);assert.deepEqual(f.runtime.kernel.snapshot(),before);}finally{f.cleanup();}
});}

test('concurrent planning is bounded; revocation during inference prevents durable commit',async()=>{
 let resolve!:(p:ProposedPlan)=>void;const wait=new Promise<ProposedPlan>(r=>{resolve=r;});const f=await fixture(provider(()=>wait));
 try{
  const first=f.post();await new Promise(r=>setImmediate(r));
  assert.equal((await f.post()).status,409);f.repository.revokeSession('owner-token-123456');resolve(proposal());
  assert.equal((await first).status,401);assert.equal(f.runtime.kernel.snapshot().tasks.job!.planVersion,0);
 }finally{f.cleanup();}
});

test('timeout and late provider response cannot persist a plan; next explicit attempt remains possible',async()=>{
 let resolve!:(p:ProposedPlan)=>void;let calls=0;const wait=new Promise<ProposedPlan>(r=>{resolve=r;});
 const f=await fixture(provider(()=>++calls===1?wait:proposal()),15);
 try{
  // Keep the test alive while the provider ignores its AbortSignal.
  const keep=setTimeout(()=>{},100);assert.equal((await f.post()).status,400);clearTimeout(keep);
  resolve(proposal());await new Promise(r=>setImmediate(r));assert.equal(f.runtime.kernel.snapshot().tasks.job!.planVersion,0);
  assert.equal((await f.post()).status,201);
 }finally{f.cleanup();}
});

test('task cancellation during inference cannot be overwritten by a late plan',async()=>{
 let resolve!:(p:ProposedPlan)=>void;const f=await fixture(provider(()=>new Promise(r=>{resolve=r;})));
 try{const pending=f.post();await new Promise(r=>setImmediate(r));const state=f.runtime.kernel.snapshot();f.runtime.kernel.apply({id:'cancel',type:'GlobalTaskCancelled',taskId:'job',at:state.tasks.job!.updatedAt},state.revision);resolve(proposal());assert.equal((await pending).status,409);assert.equal(f.runtime.kernel.snapshot().tasks.job!.status,'cancelled');}finally{f.cleanup();}
});

test('workspace client calls authenticated planning route and rejects malformed success',async()=>{
 const {WorkspaceClient}=await import('../src/workspace-client.js');
 let valid=true;
 const c=new WorkspaceClient({baseUrl:'http://127.0.0.1:8790',tenantId:'agency',token:'owner-token-123456'},async(input,init)=>{
  assert.equal(String(input),'http://127.0.0.1:8790/v1/workspaces/agency/runtime/job/plan');
  const headers=new Headers(init?.headers);assert.equal(headers.get('content-type'),'application/json');assert.equal(headers.get('authorization'),'Bearer owner-token-123456');
  assert.deepEqual(JSON.parse(String(init?.body)),{workflow:'email-lead-v1'});
  return new Response(JSON.stringify({tenantId:valid?'agency':'foreign',taskId:'job',created:true,planVersion:1}),{status:201,headers:{'content-type':'application/json'}});
 });
 await c.planRuntimeTask('job');valid=false;await assert.rejects(c.planRuntimeTask('job'),/INVALID_RUNTIME_PLAN_RESPONSE/);
 await assert.rejects(c.planRuntimeTask('../foreign'),/INVALID_RUNTIME_TASK/);
});

for(const phase of ['inference','committed'])test(`SIGKILL during ${phase} restores only durable task/plan and never starts an executor`,async()=>{
 const {fork}=await import('node:child_process');const {once}=await import('node:events');
 const dir=mkdtempSync(join(tmpdir(),'autonomo-crash-')),path=join(dir,'runtime.db');
 const child=fork(new URL('./fixtures/planning-crash.ts',import.meta.url),[path,phase],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});
 const errors:string[]=[];child.stderr?.on('data',d=>errors.push(String(d)));
 try{
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('CRASH_FIXTURE_TIMEOUT '+errors.join(''))),10_000);
   child.once('message',msg=>{clearTimeout(timer);assert.equal(msg,phase);resolve();});
   child.once('exit',code=>{clearTimeout(timer);reject(new Error('EARLY_EXIT '+code+' '+errors.join('')));});
  });
  const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  const runtime=await openWorkspaceRuntime(path,'agency',{provider:provider(()=>{throw new Error('must not infer on startup');})});
  try{const state=runtime.kernel.snapshot();assert.equal(state.tasks.job!.planVersion,phase==='committed'?1:0);assert.equal(state.tasks.job!.status,phase==='committed'?'ready':'created');assert.equal(Object.keys(state.attempts).length,0);assert.equal(state.workUnits['job-p1-s7']?.successCriteria[0]?.kind,phase==='committed'?'custom':undefined);}finally{runtime.close();}
 }finally{child.kill('SIGKILL');rmSync(dir,{recursive:true,force:true});}
});

test('an existing unrelated plan cannot masquerade as an idempotent email workflow response',async()=>{
 const f=await fixture(provider(()=>{throw new Error('must not infer');}));
 try{
  let state=f.runtime.kernel.snapshot();const at=state.tasks.job!.updatedAt;
  f.runtime.kernel.apply({id:'other-start',taskId:'job',at,type:'GlobalTaskPlanningStarted'},state.revision);
  state=f.runtime.kernel.snapshot();f.runtime.kernel.apply({id:'other-plan',taskId:'job',at,type:'PlanCommitted',planVersion:1,workUnits:[{id:'other-unit',title:'Other',objective:'Other',dependencies:[],requiredCapabilities:[],constraints:[],expectedArtifacts:[],successCriteria:[{id:'review',kind:'human-approval',approver:'owner'}]}]},state.revision);
  assert.equal((await f.post()).status,409);assert.equal(f.runtime.kernel.snapshot().tasks.job!.planVersion,1);
 }finally{f.cleanup();}
});
