import {crmId,crmRef,crmRecord,crmText,crmTime,crmEnum,normalizeCrmEmail} from './crm-contract.js';
import {MAIL_TOPICS,MAIL_LINES} from './mail-assistance-contract.js';
import {validateEmailReply} from './email-reply.js';
import type {MailProposal} from './mail-assistance-contract.js';
export interface MailTaskInput {
 accountRef:string;gmailId:string;proposalId:string;contactId:string;
 to:string;subject:string;body:string;recipientReviewed:true;
 followUpTitle:string;followUpDueAt:number;
}
export interface MailTaskBinding {
 revision?:number;revisesTaskId?:string;
 taskId:string;owner:string;accountRef:string;gmailId:string;ns:string;
 sourceHash:string;proposalId:string;proposalHash:string;requestHash:string;
 providerContext:string;contactId:string;recipient:string;at:number;
 model:string;provider:string;topic:MailProposal['topic'];line:MailProposal['line'];priority:MailProposal['priority'];
 followUpTitle:string;followUpDueAt:number;
 reply:{threadId:string;inReplyTo:string;references:string}|null;
}
export interface MailTaskView {tenantId:string;accountRef:string;gmailId:string;taskId:string|null;created:boolean;}
export function parseMailTaskBinding(raw:unknown):MailTaskBinding{
 const r=crmRecord(raw);
 if(Object.keys(r).filter(k=>!['revision','revisesTaskId'].includes(k)).sort().join(',')!=='accountRef,at,contactId,followUpDueAt,followUpTitle,gmailId,line,model,ns,owner,priority,proposalHash,proposalId,provider,providerContext,recipient,reply,requestHash,sourceHash,taskId,topic')throw new Error('MAIL_TASK_INVALID_BINDING');
 const revised=r.revision!==undefined||r.revisesTaskId!==undefined;
 if(revised&&(!Number.isSafeInteger(r.revision)||Number(r.revision)<2||Number(r.revision)>100||r.taskId===r.revisesTaskId))throw new Error('MAIL_TASK_INVALID_BINDING');
 const hash=(v:unknown)=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw new Error('MAIL_TASK_INVALID_BINDING');return v;};
 return {taskId:crmId(r.taskId),owner:crmId(r.owner),accountRef:crmRef(r.accountRef),gmailId:crmId(r.gmailId),ns:hash(r.ns),sourceHash:hash(r.sourceHash),proposalId:crmId(r.proposalId),proposalHash:hash(r.proposalHash),requestHash:hash(r.requestHash),providerContext:crmText(r.providerContext,120),contactId:crmId(r.contactId),recipient:normalizeCrmEmail(r.recipient),at:crmTime(r.at),model:crmText(r.model,120),provider:crmText(r.provider,120),topic:crmEnum(r.topic,MAIL_TOPICS),line:crmEnum(r.line,MAIL_LINES),priority:crmEnum(r.priority,['normal','high','urgent']),followUpTitle:crmText(r.followUpTitle,300),followUpDueAt:crmTime(r.followUpDueAt),reply:r.reply===null?null:validateEmailReply(r.reply),...(revised?{revision:Number(r.revision),revisesTaskId:crmId(r.revisesTaskId)}:{})};
}
export function parseMailTaskInput(raw:unknown):MailTaskInput {
 const r=crmRecord(raw);
 if(Object.keys(r).sort().join(',')!=='accountRef,body,contactId,followUpDueAt,followUpTitle,gmailId,proposalId,recipientReviewed,subject,to'||r.recipientReviewed!==true)throw new Error('MAIL_TASK_INVALID_INPUT');
 const subject=crmText(r.subject,500);if(/[\r\n]/.test(subject))throw new Error('MAIL_TASK_INVALID_INPUT');
 return {accountRef:crmRef(r.accountRef),gmailId:crmId(r.gmailId),proposalId:crmId(r.proposalId),contactId:crmId(r.contactId),to:normalizeCrmEmail(r.to),subject,body:crmText(r.body,8000),recipientReviewed:true,followUpTitle:crmText(r.followUpTitle,300),followUpDueAt:crmTime(r.followUpDueAt)};
}
export function parseMailTaskView(raw:unknown,tenant:string,accountRef:string,gmailId:string):MailTaskView {
 const r=crmRecord(raw);
 if(Object.keys(r).sort().join(',')!=='accountRef,created,gmailId,taskId,tenantId'||r.tenantId!==tenant||r.accountRef!==accountRef||r.gmailId!==gmailId||typeof r.created!=='boolean'||r.taskId===null&&r.created)throw new Error('MAIL_TASK_INVALID_VIEW');
 return {tenantId:tenant,accountRef:crmRef(r.accountRef),gmailId:crmId(r.gmailId),taskId:r.taskId===null?null:crmId(r.taskId),created:r.created};
}
