import {RuntimeDatabase,JournalKernel,ReplayClock,createDurableTaskRuntime} from '@agent-world/runtime-store-sqlite';
import type {WorkspaceRuntimeSource} from './workspace-api.js';
/** One tenant per authoritative journal. Startup fails on tenant mismatch or replay
 * drift; no empty/demo replacement is returned when persistence fails. */
export async function openWorkspaceRuntime(path:string,tenantId:string) {
 if(!tenantId.trim()) throw new Error('RUNTIME_TENANT_REQUIRED');
 const database=new RuntimeDatabase(path);
 try {
  const journal=new JournalKernel(database,new ReplayClock());
  const binding=journal.register('pymesTenantBinding',()=>new TenantBinding(),['bind']);
  const kernel=createDurableTaskRuntime(journal);await journal.restore();
  if(binding.get()!==null && binding.get()!==tenantId) throw new Error('RUNTIME_TENANT_BINDING_MISMATCH');
  if(binding.get()===null) {
   if(database.commands().length) throw new Error('UNBOUND_RUNTIME_JOURNAL');
   binding.bind(tenantId);
  }
  let closed=false;
  const source:WorkspaceRuntimeSource={snapshotForTenant:tenant=>{
   if(closed) throw new Error('RUNTIME_CLOSED');
   return tenant===tenantId?kernel.snapshot():null;
  },principalIdForSession:principal=>{
   if(principal.tenantId!==tenantId) throw new Error('RUNTIME_TENANT_SCOPE_DENIED');
   return principal.userId;
  },createTask:(tenant,owner,input)=>{
   if(closed) throw new Error('RUNTIME_CLOSED');
   if(tenant!==tenantId) throw new Error('RUNTIME_TENANT_SCOPE_DENIED');
   const state=kernel.snapshot(),existing=state.tasks[input.id];
   if(existing) {
    if(existing.owner!==owner || existing.goal!==input.goal) throw new Error('RUNTIME_TASK_ID_CONFLICT');
    return {created:false};
   }
   kernel.apply({id:`create-${input.id}`,taskId:input.id,at:Date.now(),type:'GlobalTaskCreated',goal:input.goal,owner,
    successCriteria:[{id:'professional-review',kind:'human-approval',approver:owner}]},state.revision);
   return {created:true};
  }};
  return {source,kernel,close:()=>{if(!closed){closed=true;database.close();}}};
 } catch(error) {database.close();throw error;}
}

class TenantBinding {
 private tenantId:string|null=null;
 bind(tenantId:string):{tenantId:string} {
  if(!tenantId.trim() || this.tenantId!==null && this.tenantId!==tenantId) throw new Error('RUNTIME_TENANT_BINDING_MISMATCH');
  this.tenantId=tenantId;return {tenantId};
 }
 get():string|null {return this.tenantId;}
}
