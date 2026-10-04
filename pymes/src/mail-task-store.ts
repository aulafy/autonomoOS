import {emailHash} from './email-provider.js';
import {crmId,crmRef} from './crm-contract.js';
import type {MailTaskBinding} from './mail-task-contract.js';
import {parseMailTaskBinding} from './mail-task-contract.js';
/** Journal projection of a reviewed mail source. No raw incoming body is copied. */
export class MailTaskStore {
 private records=new Map<string,MailTaskBinding>();
 bind(value:MailTaskBinding){
  value=parseMailTaskBinding(value);
  crmId(value.taskId);crmId(value.owner);crmRef(value.accountRef);crmId(value.gmailId);
  for(const h of [value.sourceHash,value.proposalHash,value.requestHash])if(!/^[a-f0-9]{64}$/.test(h))throw new Error('MAIL_TASK_INVALID_BINDING');
  const existing=this.byMail(value.owner,value.accountRef,value.gmailId);
  if(existing){if(existing.taskId!==value.taskId||existing.requestHash!==value.requestHash)throw new Error('MAIL_TASK_ALREADY_BOUND');return existing;}
  if(this.records.has(value.taskId)||this.records.size>=50000)throw new Error('MAIL_TASK_BINDING_CONFLICT');
  this.records.set(value.taskId,structuredClone(value));return structuredClone(value);
 }
 task(taskId:string,owner?:string){const r=this.records.get(taskId);return r&&(!owner||r.owner===owner)?structuredClone(r):null;}
 byMail(owner:string,ref:string,id:string){return structuredClone([...this.records.values()].reverse().find(r=>r.owner===owner&&r.accountRef===ref&&r.gmailId===id)??null);}
 replacement(taskId:string){return [...this.records.values()].find(r=>r.revisesTaskId===taskId)?.taskId??null;}
 /** Append a successor; never overwrite the rejected/withdrawn task or source. */
 bindRevision(value:MailTaskBinding){
  value=parseMailTaskBinding(value);const previous=this.task(value.revisesTaskId??'');
  if(!previous||value.revision!==(previous.revision??1)+1)throw new Error('MAIL_TASK_REVISION_INVALID');
  const immutable=(b:MailTaskBinding)=>{const {taskId,at,revision,revisesTaskId,...source}=b;return emailHash(source);};
  if(immutable(previous)!==immutable(value))throw new Error('MAIL_TASK_REVISION_SCOPE_CHANGED');
  const existing=this.replacement(previous.taskId);
  if(existing){const r=this.task(existing)!;if(emailHash(r)!==emailHash(value))throw new Error('MAIL_TASK_REVISION_CONFLICT');return r;}
  if(this.byMail(previous.owner,previous.accountRef,previous.gmailId)?.taskId!==previous.taskId||this.records.has(value.taskId)||this.records.size>=50000)throw new Error('MAIL_TASK_REVISION_CONFLICT');
  this.records.set(value.taskId,structuredClone(value));return structuredClone(value);
 }
 hash(taskId:string){const r=this.task(taskId);return r?emailHash(r):null;}
}
