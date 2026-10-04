import {MailAssistanceService} from './mail-assistance-service.js';
import {MailTaskStore} from './mail-task-store.js';
import {MailTaskService} from './mail-task-service.js';
import {LocalJsonProvider,type JsonProposalProvider} from '@agent-world/inference';
import {CrmStore} from './crm-store.js';
import {CrmService} from './crm-service.js';
import {createEmailGovernance} from './email-governance.js';
import {createEmailWorkflow} from './email-workflow.js';
import {EmailReviewStore} from './email-review-store.js';
import {FakeEmailProvider,type EmailProvider} from './email-provider.js';
import { LlamaCppProvider, type InferenceProvider } from '@agent-world/inference';
import {proposeEmailLeadPlan,defineEmailLeadUnits,EMAIL_LEAD_WORKFLOW} from './job-planner.js';
import {RuntimeDatabase,JournalKernel,ReplayClock,createDurableTaskRuntime,createDurableDomainStores} from '@agent-world/runtime-store-sqlite';
import type {WorkspaceRuntimeSource} from './workspace-api.js';
/** One tenant per authoritative journal. Startup fails on tenant mismatch or replay
 * drift; no empty/demo replacement is returned when persistence fails. */
export async function openWorkspaceRuntime(path:string,tenantId:string,options:{mailProposalProvider?:JsonProposalProvider;provider?:InferenceProvider;planningTimeoutMs?:number;fakeEmail?:boolean;emailProvider?:EmailProvider;gmail?:import('./gmail-local-connector.js').GmailLocalConnector;gmailInbox?:import('./inbox-service.js').InboxService;emailHooks?:{beforeDispatch?:()=>void;afterDispatchMarker?:()=>void}}={}) {
 if(!tenantId.trim()) throw new Error('RUNTIME_TENANT_REQUIRED');
 const database=new RuntimeDatabase(path);let ownEmail:FakeEmailProvider|null=null;
 try {
  const journal=new JournalKernel(database,new ReplayClock());
  const binding=journal.register('pymesTenantBinding',()=>new TenantBinding(),['bind']);
  const kernel=createDurableTaskRuntime(journal);
  const domain=createDurableDomainStores(journal);
  const crmStore=journal.register('pymesCrm',()=>new CrmStore(tenantId),['apply']);
  const emailReviews=journal.register('pymesEmailReviews',()=>new EmailReviewStore(),['propose','decide','audit','recordPolicy','recordArtifact','saveDraft']);
  const mailTaskStore=journal.register('pymesMailTasks',()=>new MailTaskStore(),['bind']);
  await journal.restore();
  if(binding.get()!==null && binding.get()!==tenantId) throw new Error('RUNTIME_TENANT_BINDING_MISMATCH');
  if(binding.get()===null) {
   if(database.commands().length) throw new Error('UNBOUND_RUNTIME_JOURNAL');
   binding.bind(tenantId);
  }
  let closed=false;
  const planningTimeoutMs=options.planningTimeoutMs??30_000;
  if(!Number.isInteger(planningTimeoutMs)||planningTimeoutMs<1||planningTimeoutMs>60_000)throw new Error('INVALID_PLANNING_TIMEOUT');
  const provider=options.provider??new LlamaCppProvider();
  ownEmail=options.fakeEmail&&!options.emailProvider&&!options.gmail?new FakeEmailProvider(path+'.fake-email.db'):null;
  const emailProvider=options.gmail?.provider??options.emailProvider??ownEmail;
  const crm=new CrmService(crmStore,journal,tenantId,options.gmailInbox);
  const mailAiKind=process.env.PYMES_MAIL_AI_PROVIDER??'ollama';
  if(options.gmailInbox&&!['ollama','llama.cpp'].includes(mailAiKind))throw new Error('MAIL_AI_PROVIDER_INVALID');
  const mailAssistance=options.gmailInbox?new MailAssistanceService(options.gmailInbox,options.mailProposalProvider??new LocalJsonProvider({kind:mailAiKind as 'ollama'|'llama.cpp',model:process.env.PYMES_MAIL_AI_MODEL??process.env.PYMES_LOCAL_MODEL??'llama3.2:3b',baseUrl:process.env.PYMES_MAIL_AI_URL,apiKey:process.env.PYMES_MAIL_AI_PROVIDER==='llama.cpp'?process.env.LLAMA_API_KEY:undefined})):undefined;
  const sender=()=>options.gmail?options.gmail.provider.account():'office@example.test',providerContext=()=>options.gmail?options.gmail.provider.approvalBinding():emailProvider!.id;
  const mailTasks=options.gmailInbox&&mailAssistance&&emailProvider?new MailTaskService(tenantId,options.gmailInbox,mailTaskStore,mailAssistance,crm,kernel,journal,emailReviews,sender,p=>emailProvider.prepare(p),providerContext):undefined;
  const sourceFor=(id:string)=>mailTaskStore.task(id);
  const requireSource=(id:string)=>{if(sourceFor(id)&&!mailTasks)throw new Error('MAIL_TASK_SOURCE_UNAVAILABLE');};
  const email=emailProvider?createEmailWorkflow(kernel,journal,emailReviews,createEmailGovernance(journal,domain,emailReviews,emailProvider,options.emailHooks),()=>({from:'office@example.test',to:['client@example.test'],cc:[],bcc:[],subject:'Respuesta a su consulta · simulación',body:'Gracias por su consulta. Prepararemos los siguientes pasos y le confirmaremos la información necesaria. Este correo es una simulación local.',contactId:'simulated-contact'}),{crm:crm.workflowAdapter(sourceFor),...(options.gmail?{simulated:false,context:providerContext}:{}),draftFrom:sender,validatePayload:p=>emailProvider.prepare(p),sourceFor,checkSource:async(id,owner)=>{requireSource(id);await mailTasks?.check(id,owner);},assertSource:(id,owner)=>{requireSource(id);mailTasks?.assert(id,owner);},assertPayload:(id,owner,p)=>{requireSource(id);mailTasks?.assertPayload(id,owner,p);}}):undefined;
  const planning=new Set<string>();
  const source:WorkspaceRuntimeSource={mailTasks,mailAssistance,crm,email,gmail:options.gmail,gmailInbox:options.gmailInbox,planTask:async(tenant,owner,input,mayCommit)=>{
   if(closed||!journal.isHealthy())throw new Error('RUNTIME_CLOSED');
   if(tenant!==tenantId)throw new Error('RUNTIME_TENANT_SCOPE_DENIED');
   if(input.workflow!==EMAIL_LEAD_WORKFLOW)throw new Error('INVALID_WORKFLOW');
   const task=kernel.snapshot().tasks[input.taskId];
   if(!task||task.owner!==owner)throw new Error('RUNTIME_TASK_NOT_FOUND');
   // Repeating a confirmed plan request never invokes inference or dispatch again.
   if(task.planVersion>0){
    const state=kernel.snapshot(),saved=state.plans.find(p=>p.taskId===task.id&&p.version===task.planVersion);
    const expected=defineEmailLeadUnits({...task,planVersion:task.planVersion-1});
    const actual=saved?.workUnitIds.map(id=>{
     const u=state.workUnits[id];if(!u)return null;
     return {id:u.id,title:u.title,objective:u.objective,dependencies:u.dependencies,requiredCapabilities:u.requiredCapabilities,
      constraints:u.constraints,expectedArtifacts:u.expectedArtifacts,successCriteria:u.successCriteria};
    });
    if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('RUNTIME_PLAN_WORKFLOW_CONFLICT');
    return {created:false,planVersion:task.planVersion};
   }
   if(task.status!=='created')throw new Error('RUNTIME_TASK_NOT_PLANNABLE');
   if(planning.size>0)throw new Error('RUNTIME_PLANNING_IN_PROGRESS');
   planning.add(task.id);
   const signal=AbortSignal.timeout(planningTimeoutMs);
   try {
    // No durable mutation during inference: a crash leaves a safely replannable task.
    const units=await Promise.race([proposeEmailLeadPlan(provider,task,signal),
     new Promise<never>((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('LOCAL_PLANNING_TIMEOUT')),{once:true}))]);
    signal.throwIfAborted();
    if(closed||!journal.isHealthy())throw new Error('RUNTIME_CLOSED');
    if(mayCommit&&!mayCommit())throw new Error('RUNTIME_AUTH_CHANGED');
    const current=kernel.snapshot().tasks[task.id];
    if(!current||current.status!=='created'||current.planVersion!==task.planVersion||current.updatedAt!==task.updatedAt)throw new Error('RUNTIME_TASK_CHANGED');
    const at=Math.max(Date.now(),current.updatedAt);
    journal.transaction(()=>{
     kernel.apply({id:`planning-${task.id}-p1`,taskId:task.id,at,type:'GlobalTaskPlanningStarted'},kernel.snapshot().revision);
     kernel.apply({id:`plan-${task.id}-p1`,taskId:task.id,at,type:'PlanCommitted',planVersion:1,workUnits:units},kernel.snapshot().revision);
    });
    return {created:true,planVersion:1};
   }finally{planning.delete(task.id);}
  },snapshotForTenant:tenant=>{
   if(closed||!journal.isHealthy()) throw new Error('RUNTIME_CLOSED');
   return tenant===tenantId?kernel.snapshot():null;
  },principalIdForSession:principal=>{
   if(principal.tenantId!==tenantId) throw new Error('RUNTIME_TENANT_SCOPE_DENIED');
   return principal.userId;
  },createTask:(tenant,owner,input)=>{
   if(closed||!journal.isHealthy()) throw new Error('RUNTIME_CLOSED');
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
  return {source,kernel,close:()=>{if(!closed){closed=true;mailAssistance?.close();crm.close();ownEmail?.close();database.close();}}};
 } catch(error) {ownEmail?.close();database.close();throw error;}
}

class TenantBinding {
 private tenantId:string|null=null;
 bind(tenantId:string):{tenantId:string} {
  if(!tenantId.trim() || this.tenantId!==null && this.tenantId!==tenantId) throw new Error('RUNTIME_TENANT_BINDING_MISMATCH');
  this.tenantId=tenantId;return {tenantId};
 }
 get():string|null {return this.tenantId;}
}
