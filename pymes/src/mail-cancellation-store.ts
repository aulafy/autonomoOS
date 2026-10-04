import {emailHash} from './email-provider.js';
import {parseMailCancellation,type MailCancellation} from './mail-cancellation-contract.js';
/** Append-only journal projection. Cancellation never deletes claims or reviews. */
export class MailCancellationStore {
 private records=new Map<string,MailCancellation>();
 private requests=new Map<string,string>();
 constructor(readonly tenant:string){}
 record(raw:MailCancellation):MailCancellation {
  const r=parseMailCancellation(raw),key=JSON.stringify([r.owner,r.requestId]);
  if(r.tenantId!==this.tenant||r.requestHash!==emailHash({tenantId:r.tenantId,owner:r.owner,taskId:r.taskId,requestId:r.requestId,expectedRevision:r.expectedRevision,expectedStateHash:r.expectedStateHash,reason:r.reason,confirmed:true}))throw new Error('EMAIL_CANCEL_RECORD_INVALID');
  const previous=this.records.get(r.taskId),request=this.requests.get(key);
  if(previous){if(emailHash(previous)!==emailHash(r))throw new Error('EMAIL_CANCEL_REQUEST_CONFLICT');return structuredClone(previous);}
  if(request||this.records.size>=50000)throw new Error('EMAIL_CANCEL_REQUEST_CONFLICT');
  this.records.set(r.taskId,structuredClone(r));this.requests.set(key,r.taskId);return structuredClone(r);
 }
 task(taskId:string,owner:string){const r=this.records.get(taskId);return r?.owner===owner?structuredClone(r):null;}
 request(owner:string,requestId:string){const id=this.requests.get(JSON.stringify([owner,requestId]));return id?this.task(id,owner):null;}
}
