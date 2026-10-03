import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openWorkspaceRuntime} from '../src/runtime-source.js';
import {WorkspaceApi,InMemoryWorkspaceRepository} from '../src/workspace-api.js';
import {handlePymesRequest} from '../src/api-server.js';
test('persisted workspace task survives reopen and reaches authenticated runtime endpoint',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pymes-runtime-'));const path=join(dir,'runtime.db');
 try {
 let runtime=await openWorkspaceRuntime(path,'agency');
 runtime.kernel.apply({id:'event',taskId:'task',at:1,type:'GlobalTaskCreated',goal:'Prepare draft',owner:'owner',successCriteria:[{id:'c',kind:'human-approval',approver:'owner'}]},0);
 runtime.close();runtime=await openWorkspaceRuntime(path,'agency');
 try {
  const api=new WorkspaceApi(new InMemoryWorkspaceRepository(),undefined,runtime.source);api.addSession('owner-token-123456',{userId:'owner',tenantId:'agency',role:'owner'});
  const response=await handlePymesRequest(api,new Request('http://localhost/v1/workspaces/agency/runtime',{headers:{authorization:'Bearer owner-token-123456'}}));
  assert.equal(response.status,200);assert.equal((await response.json()).tasks[0].id,'task');
  assert.equal(runtime.source.snapshotForTenant('foreign'),null);
 } finally {runtime.close();}
 await assert.rejects(openWorkspaceRuntime(path,'foreign'),/BINDING_MISMATCH/);
 const restored=await openWorkspaceRuntime(path,'agency');assert.equal(restored.kernel.snapshot().tasks.task!.goal,'Prepare draft');restored.close();
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('authenticated task creation is durable idempotent and cannot assign another owner',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'pymes-create-'));let runtime=await openWorkspaceRuntime(join(dir,'runtime.db'),'agency');
 try {
 const api=new WorkspaceApi(new InMemoryWorkspaceRepository(),undefined,runtime.source);api.addSession('owner-token-123456',{userId:'owner',tenantId:'agency',role:'owner'});api.addSession('worker-token-12345',{userId:'worker',tenantId:'agency',role:'worker'});
 const post=(body:unknown,token='owner-token-123456')=>handlePymesRequest(api,new Request('http://localhost/v1/workspaces/agency/runtime',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)}));
 assert.equal((await post({id:'new-task',goal:'Prepare renewal'})).status,201);
 assert.equal((await post({id:'new-task',goal:'Prepare renewal'})).status,200);
 assert.equal((await post({id:'new-task',goal:'Changed objective'})).status,409);
 assert.equal((await post({id:'other',goal:'Prepare',owner:'intruder'})).status,400);
 assert.equal((await post({id:'worker-task',goal:'Prepare'},'worker-token-12345')).status,403);
 runtime.close();runtime=await openWorkspaceRuntime(join(dir,'runtime.db'),'agency');const task=runtime.kernel.snapshot().tasks['new-task']!;
 assert.equal(task.owner,'owner');assert.equal(task.status,'created');assert.deepEqual(task.successCriteria,[{id:'professional-review',kind:'human-approval',approver:'owner'}]);assert.equal(Object.keys(runtime.kernel.snapshot().tasks).length,1);
 } finally {runtime.close();rmSync(dir,{recursive:true,force:true});}
});
