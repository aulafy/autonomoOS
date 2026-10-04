import type {TaskRuntimeKernel} from '@agent-world/task-runtime';
import type {JournalKernel} from '@agent-world/runtime-store-sqlite';
import {emailHash,validateEmailReply,type EmailPayload} from './email-provider.js';
import {mailSourceHash} from './mail-source.js';
import {parseMailTaskInput,type MailTaskInput,type MailTaskBinding} from './mail-task-contract.js';
import type {MailTaskStore} from './mail-task-store.js';
import type {MailAssistanceService} from './mail-assistance-service.js';
import type {CrmService} from './crm-service.js';
import type {InboxService,InboxContext} from './inbox-service.js';
import type {StoredMessage} from './inbox-store.js';
import type {EmailReviewStore} from './email-review-store.js';
import {defineEmailLeadUnits} from './job-planner.js';
import {randomUUID} from 'node:crypto';
export class MailTaskError extends Error {}
/** Explicitly selected host workflow; the model supplies proposals, never task authority. */
export class MailTaskService {
 constructor(readonly tenant:string,readonly inbox:InboxService,readonly store:MailTaskStore,private assistance:MailAssistanceService,private crm:CrmService,private kernel:TaskRuntimeKernel,private journal:JournalKernel,private drafts:EmailReviewStore,private sender:()=>string,private validatePayload:(p:unknown)=>EmailPayload,private providerContext:()=>string,private now=Date.now){}
 private ready(owner:string){if(!this.journal.isHealthy()||owner!==this.inbox.owner)throw new MailTaskError('MAIL_TASK_SCOPE_DENIED');}
 private async context(owner:string,ref:string,live:()=>boolean){
  this.ready(owner);const c=await this.inbox.context(ref);
  if(!live())throw new MailTaskError('MAIL_TASK_AUTH_CHANGED');
  if(!c.info||!c.readable)throw new MailTaskError('MAIL_TASK_SOURCE_UNAVAILABLE');return c;
 }
 async view(owner:string,ref:string,id:string,live:()=>boolean){await this.context(owner,ref,live);return this.store.byMail(owner,ref,id)?.taskId??null;}
 /** Called only after the email workflow certifies that no C6 claim exists. */
 async revise(taskId:string,owner:string,payload:EmailPayload,guard:()=>void){
  const previous=this.store.task(taskId,owner);if(!previous)throw new MailTaskError('MAIL_TASK_NOT_FOUND');
  await this.check(taskId,owner);this.assertPayload(taskId,owner,payload);guard();
  const revision=(previous.revision??1)+1;if(revision>100)throw new MailTaskError('MAIL_TASK_REVISION_LIMIT');
  const id='mail-'+randomUUID(),at=Math.max(this.now(),this.kernel.snapshot().tasks[taskId]!.updatedAt);
  const binding:MailTaskBinding={...previous,taskId:id,at,revision,revisesTaskId:taskId};
  this.journal.transaction(()=>{
   guard();this.assertPayload(taskId,owner,payload);
   const state=this.kernel.snapshot();if(state.tasks[taskId]!.workUnitIds.some(id=>state.workUnits[id]!.activeAttemptId))throw new MailTaskError('MAIL_TASK_ACTIVE_ATTEMPT');
   this.kernel.apply({id:randomUUID(),taskId,at,type:'GlobalTaskCancelled'},state.revision);
   this.store.bindRevision(binding);
   this.kernel.apply({id:randomUUID(),taskId:id,at,type:'GlobalTaskCreated',goal:state.tasks[taskId]!.goal,owner,successCriteria:state.tasks[taskId]!.successCriteria},this.kernel.snapshot().revision);
   this.kernel.apply({id:randomUUID(),taskId:id,at,type:'GlobalTaskPlanningStarted'},this.kernel.snapshot().revision);
   this.kernel.apply({id:randomUUID(),taskId:id,at,type:'PlanCommitted',planVersion:1,workUnits:defineEmailLeadUnits({id,owner,planVersion:0})},this.kernel.snapshot().revision);
   this.drafts.saveDraft({taskId:id,owner,payload,at});
   this.drafts.audit({id:randomUUID(),taskId,type:'draft.superseded',reference:id,at});
   this.drafts.audit({id:randomUUID(),taskId:id,type:'draft.revised_from',reference:taskId,at});
  });return id;
 }
 private contact(owner:string,id:string,to:string,ref:string,gid:string){
  const c=this.crm.store.contact(owner,id),link=this.crm.store.link(owner,ref,gid);
  if(!c||c.status!=='active'||link?.contactId!==id||!this.crm.store.match(owner,to).some(c=>c.id===id))throw new MailTaskError('MAIL_TASK_CONTACT_REVIEW_REQUIRED');
 }
 private reply(m:StoredMessage,subject:string):MailTaskBinding['reply']{
  const canonical=(s:string)=>s.replace(/^(?:Re:\s*)+/i,'');
  if(!m.threadId||!m.messageId||!m.subject||canonical(subject)!==canonical(m.subject))return null;
  const refs=(m.references??'').trim().split(/\s+/).filter(Boolean);
  if(refs.at(-1)!==m.messageId)refs.push(m.messageId);
  try{return validateEmailReply({threadId:m.threadId,inReplyTo:m.messageId,references:refs.join(' ')});}catch{throw new MailTaskError('MAIL_TASK_THREAD_REVIEW_REQUIRED');}
 }
 async create(owner:string,raw:MailTaskInput,live:()=>boolean){
  const input=parseMailTaskInput(raw),requestHash=emailHash(input),ctx=await this.context(owner,input.accountRef,live);
  const previous=this.store.byMail(owner,input.accountRef,input.gmailId);
  if(previous){if(previous.requestHash!==requestHash)throw new MailTaskError('MAIL_TASK_ALREADY_EXISTS');return {taskId:previous.taskId,created:false};}
  if(!ctx.connectedSubject||!ctx.readScope)throw new MailTaskError('MAIL_TASK_GMAIL_REQUIRED');
  const proposal=await this.assistance.view(owner,input.accountRef,input.gmailId,live);
  if(!proposal||proposal.id!==input.proposalId||proposal.state!=='accepted')throw new MailTaskError('MAIL_TASK_PROPOSAL_REVIEW_REQUIRED');
  const fresh=await this.context(owner,input.accountRef,live),m=this.inbox.store.messageDetail(fresh.info!.ns,input.gmailId);
  if(!fresh.connectedSubject||!fresh.readScope||ctx.generation!==fresh.generation||ctx.info!.ns!==fresh.info!.ns||!m||m.labels.includes('SENT')||proposal.sourceHash!==mailSourceHash(input.accountRef,m))throw new MailTaskError('MAIL_TASK_SOURCE_CHANGED');
  this.contact(owner,input.contactId,input.to,input.accountRef,input.gmailId);
  if(input.followUpDueAt<this.now()||input.followUpDueAt>this.now()+366*5*86400000)throw new MailTaskError('MAIL_TASK_FOLLOWUP_INVALID');
  const taskId='mail-'+emailHash({tenant:this.tenant,owner,accountRef:input.accountRef,gmailId:input.gmailId}).slice(0,40),reply=this.reply(m,input.subject);
  const payload=this.validatePayload({from:this.sender(),to:[input.to],cc:[],bcc:[],subject:input.subject,body:input.body,contactId:input.contactId,...(reply?{reply}:{})});
  const binding:MailTaskBinding={taskId,owner,accountRef:input.accountRef,gmailId:input.gmailId,ns:fresh.info!.ns,sourceHash:proposal.sourceHash,proposalId:proposal.id,proposalHash:emailHash(proposal),requestHash,providerContext:this.providerContext(),contactId:input.contactId,recipient:input.to,at:this.now(),model:proposal.model,provider:proposal.provider,topic:proposal.proposal.topic,line:proposal.proposal.line,priority:proposal.proposal.priority,followUpTitle:input.followUpTitle,followUpDueAt:input.followUpDueAt,reply};
  if(!live())throw new MailTaskError('MAIL_TASK_AUTH_CHANGED');
  this.journal.transaction(()=>{
   if(this.kernel.snapshot().tasks[taskId])throw new MailTaskError('MAIL_TASK_ID_CONFLICT');
   this.store.bind(binding);
   this.kernel.apply({id:`create-${taskId}`,taskId,at:binding.at,type:'GlobalTaskCreated',goal:('Responder a '+(m.subject??'consulta por correo')).slice(0,2000),owner,successCriteria:[{id:'professional-review',kind:'human-approval',approver:owner}]},this.kernel.snapshot().revision);
   this.kernel.apply({id:`planning-${taskId}`,taskId,at:binding.at,type:'GlobalTaskPlanningStarted'},this.kernel.snapshot().revision);
   this.kernel.apply({id:`plan-${taskId}`,taskId,at:binding.at,type:'PlanCommitted',planVersion:1,workUnits:defineEmailLeadUnits({id:taskId,owner,planVersion:0})},this.kernel.snapshot().revision);
   this.drafts.saveDraft({taskId,owner,payload,at:binding.at});
   this.drafts.audit({id:`source-${taskId}`,taskId,type:'mail.source.reviewed',reference:emailHash(binding),at:binding.at});
  });
  return {taskId,created:true};
 }
 /** Fresh credential checks precede review/approval/admission; the synchronous
  * assertion repeats local source/CRM checks at C11's last dispatch boundary. */
 async check(taskId:string,owner:string){
  const b=this.store.task(taskId,owner);if(!b)return;
  const ctx=await this.context(owner,b.accountRef,()=>true);
  if(!ctx.connectedSubject||!ctx.readScope||ctx.info!.ns!==b.ns)throw new MailTaskError('MAIL_TASK_GMAIL_REQUIRED');
  this.assert(taskId,owner);
 }
 assert(taskId:string,owner:string){
  const b=this.store.task(taskId);if(!b)return;
  this.ready(owner);if(b.owner!==owner||this.providerContext()!==b.providerContext)throw new MailTaskError('MAIL_TASK_AUTH_CHANGED');
  const m=this.inbox.store.messageDetail(b.ns,b.gmailId);
  if(!m||mailSourceHash(b.accountRef,m)!==b.sourceHash)throw new MailTaskError('MAIL_TASK_SOURCE_CHANGED');
  this.contact(owner,b.contactId,b.recipient,b.accountRef,b.gmailId);
 }
 assertPayload(taskId:string,owner:string,p:EmailPayload){
  const b=this.store.task(taskId);if(!b)return;
  this.assert(taskId,owner);
  if(p.contactId!==b.contactId||p.to.length!==1||p.to[0]!==b.recipient||emailHash(p.reply??null)!==emailHash(b.reply))throw new MailTaskError('MAIL_TASK_DRAFT_SCOPE_CHANGED');
  if(b.reply){const original=this.inbox.store.messageDetail(b.ns,b.gmailId)!;if(p.subject.replace(/^(?:Re:\s*)+/i,'')!==(original.subject??'').replace(/^(?:Re:\s*)+/i,''))throw new MailTaskError('MAIL_TASK_THREAD_SUBJECT_CHANGED');}
 }
}
