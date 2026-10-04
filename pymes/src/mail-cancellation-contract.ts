import {crmId,crmRecord,crmText} from './crm-contract.js';
export interface MailCancelInput {
 requestId:string;expectedRevision:number;expectedStateHash:string;reason:string|null;confirmed:true;
}
export interface MailCancellation extends MailCancelInput {
 id:string;tenantId:string;owner:string;actor:string;taskId:string;at:number;
 planVersion:number;previousStatus:string;requestHash:string;
}
export interface MailCancellationState {
 canCancel:boolean;blockedReason:string|null;expectedRevision:number;expectedStateHash:string;
 contactName:string|null;
}
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const revision=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=1&&Number(v)<=100;
export function parseMailCancelInput(raw:unknown):MailCancelInput {
 const r=crmRecord(raw);
 if(Object.keys(r).some(k=>!['requestId','expectedRevision','expectedStateHash','reason','confirmed'].includes(k))||r.confirmed!==true||!revision(r.expectedRevision)||!hash(r.expectedStateHash))throw new Error('EMAIL_CANCEL_INPUT_INVALID');
 const reason=r.reason===undefined||r.reason===null?null:crmText(r.reason,500);
 return {requestId:crmId(r.requestId),expectedRevision:Number(r.expectedRevision),expectedStateHash:String(r.expectedStateHash),reason,confirmed:true};
}
export function parseMailCancellation(raw:unknown):MailCancellation {
 const r=crmRecord(raw);
 if(Object.keys(r).sort().join(',')!=='actor,at,confirmed,expectedRevision,expectedStateHash,id,owner,planVersion,previousStatus,reason,requestHash,requestId,taskId,tenantId'||!hash(r.requestHash)||!Number.isSafeInteger(r.at)||Number(r.at)<0||!Number.isSafeInteger(r.planVersion)||Number(r.planVersion)<1||!['created','planning','ready','running','waiting','verifying','blocked'].includes(String(r.previousStatus)))throw new Error('EMAIL_CANCEL_RECORD_INVALID');
 const input=parseMailCancelInput(Object.fromEntries(['requestId','expectedRevision','expectedStateHash','reason','confirmed'].map(k=>[k,r[k]])));
 const owner=crmId(r.owner),actor=crmId(r.actor);if(owner!==actor)throw new Error('EMAIL_CANCEL_ACTOR_INVALID');
 return {...input,id:crmId(r.id),tenantId:crmId(r.tenantId),owner,actor,taskId:crmId(r.taskId),at:Number(r.at),planVersion:Number(r.planVersion),previousStatus:String(r.previousStatus),requestHash:String(r.requestHash)};
}
export function parseMailCancellationState(raw:unknown):MailCancellationState {
 const r=crmRecord(raw);
 if(Object.keys(r).sort().join(',')!=='blockedReason,canCancel,contactName,expectedRevision,expectedStateHash'||typeof r.canCancel!=='boolean'||!revision(r.expectedRevision)||!hash(r.expectedStateHash)||r.blockedReason!==null&&(typeof r.blockedReason!=='string'||!/^EMAIL_[A-Z0-9_]{1,80}$/.test(r.blockedReason))||r.canCancel!==(r.blockedReason===null))throw new Error('EMAIL_CANCEL_STATE_INVALID');
 return {canCancel:r.canCancel,blockedReason:r.blockedReason as string|null,expectedRevision:Number(r.expectedRevision),expectedStateHash:String(r.expectedStateHash),contactName:r.contactName===null?null:crmText(r.contactName,200)};
}
