import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskRuntimeKernel} from '@agent-world/task-runtime';
import {WorkspaceApi,InMemoryWorkspaceRepository} from '../src/workspace-api.js';
import {handlePymesRequest} from '../src/api-server.js';
function fixture(){const kernel=new TaskRuntimeKernel();kernel.apply({id:'e',taskId:'task',at:1,type:'GlobalTaskCreated',goal:'Prepare draft',owner:'host-owner',successCriteria:[{id:'c',kind:'test',command:'private command',expectedExitCode:0}]},0);let reads=0;
 const api=new WorkspaceApi(new InMemoryWorkspaceRepository(),undefined,{snapshotForTenant:tenant=>{reads++;return tenant==='agency'?kernel.snapshot():null;},principalIdForSession:p=>p.userId==='owner'?'host-owner':'host-other'});
 api.addSession('owner-token-123456',{userId:'owner',tenantId:'agency',role:'owner'});api.addSession('other-token-123456',{userId:'other',tenantId:'agency',role:'owner'});api.addSession('worker-token-12345',{userId:'worker',tenantId:'agency',role:'worker'});
 return {api,reads:()=>reads};}
const request=(path='/v1/workspaces/agency/runtime',token='owner-token-123456')=>new Request(`http://localhost${path}`,{headers:token?{authorization:`Bearer ${token}`}:{}});
test('authenticated runtime endpoint returns owner view with no private criterion body',async()=>{const f=fixture();const response=await handlePymesRequest(f.api,request());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const body=await response.json();assert.equal(body.tasks[0].id,'task');assert.equal(JSON.stringify(body).includes('private command'),false);assert.equal((await (await handlePymesRequest(f.api,request('/v1/workspaces/agency/runtime/task'))).json()).tasks.length,1);});
test('authentication tenant and worker permissions are checked before runtime access',async()=>{const f=fixture();assert.equal((await handlePymesRequest(f.api,request(undefined,''))).status,401);assert.equal((await handlePymesRequest(f.api,request('/v1/workspaces/other/runtime'))).status,403);assert.equal((await handlePymesRequest(f.api,request(undefined,'worker-token-12345'))).status,403);assert.equal(f.reads(),0);});
test('session mapping prevents same-tenant access to another owners tasks',async()=>{const f=fixture();const response=await handlePymesRequest(f.api,request(undefined,'other-token-123456'));assert.deepEqual((await response.json()).tasks,[]);});
test('unconfigured runtime is explicit and does not substitute demo tasks',async()=>{const api=new WorkspaceApi();api.addSession('owner-token-123456',{userId:'owner',tenantId:'agency',role:'owner'});const response=await handlePymesRequest(api,request());assert.equal(response.status,404);assert.equal((await response.json()).error,'RUNTIME_NOT_CONFIGURED');});
