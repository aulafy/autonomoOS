import {crmId, crmRevision, crmText, crmTime, crmEnum} from './crm-contract.js';
import {tgRecord, tgExact, tgChat, tgInt, TelegramError} from './telegram-contract.js';
export interface TelegramIdentitySource {botId:string; chatId:string; senderId:string; messageId:number; updateId:number;}
export interface TelegramIdentityCommand {
 commandId:string; expectedRevision:number; crmRevision:number; connectionRevision:number;
 botId:string; updateId:number; operation:'verify'|'revoke'; contactId:string|null; linkId:string|null;
 reviewed:true; note:string;
}
export interface TelegramIdentityLink {
 id:string; contactId:string; contactVersion:number; source:TelegramIdentitySource;
 verifiedAt:number; actor:string; note:string; revokedAt:number|null; revokedBy:string|null;
}
export interface TelegramIdentityAudit {
 commandId:string; operation:'verify'|'revoke'; linkId:string; contactId:string;
 actor:string; at:number; revision:number; source:TelegramIdentitySource; note:string;
}
export interface TelegramIdentityView {
 tenantId:string; ownerId:string; revision:number; crmRevision:number; connectionRevision:number;
 source:TelegramIdentitySource; link:TelegramIdentityLink|null;
 contact:{id:string; name:string; status:'active'|'archived'; version:number}|null;
 audit:TelegramIdentityAudit[];
}
export interface TelegramContactIdentities {
 tenantId:string; ownerId:string; revision:number; connectionRevision:number; contactId:string;
 items:TelegramIdentityLink[]; total:number; truncated:boolean;
}
export interface TelegramIdentityReceipt {revision:number; decisionId:string; linkId:string;}
export function parseTelegramIdentityCommand(raw:unknown):TelegramIdentityCommand {
 try {
  const r=tgRecord(raw);tgExact(r,['commandId','expectedRevision','crmRevision','connectionRevision','botId','updateId','operation','contactId','linkId','reviewed','note']);
  const operation=crmEnum(r.operation,['verify','revoke'] as const);
  if(r.reviewed!==true||operation==='verify'&&(r.contactId===null||r.linkId!==null)||operation==='revoke'&&(r.contactId!==null||r.linkId===null))throw 0;
  return {commandId:crmId(r.commandId),expectedRevision:crmRevision(r.expectedRevision),crmRevision:crmRevision(r.crmRevision),connectionRevision:crmRevision(r.connectionRevision),botId:tgChat(r.botId),updateId:tgInt(r.updateId),operation,contactId:r.contactId===null?null:crmId(r.contactId),linkId:r.linkId===null?null:crmId(r.linkId),reviewed:true,note:crmText(r.note,500,true)};
 }catch{throw new TelegramError('TELEGRAM_IDENTITY_INVALID_INPUT');}
}
function source(raw:unknown):TelegramIdentitySource {
 const r=tgRecord(raw);tgExact(r,['botId','chatId','senderId','messageId','updateId']);
 return {botId:tgChat(r.botId),chatId:tgChat(r.chatId),senderId:tgChat(r.senderId),messageId:tgInt(r.messageId,1),updateId:tgInt(r.updateId)};
}
function link(raw:unknown):TelegramIdentityLink {
 const r=tgRecord(raw);tgExact(r,['id','contactId','contactVersion','source','verifiedAt','actor','note','revokedAt','revokedBy']);
 if((r.revokedAt===null)!==(r.revokedBy===null))throw 0;
 return {id:crmId(r.id),contactId:crmId(r.contactId),contactVersion:tgInt(r.contactVersion,1),source:source(r.source),verifiedAt:crmTime(r.verifiedAt),actor:crmId(r.actor),note:crmText(r.note,500,true),revokedAt:r.revokedAt===null?null:crmTime(r.revokedAt),revokedBy:r.revokedBy===null?null:crmId(r.revokedBy)};
}
const key=(s:TelegramIdentitySource)=>JSON.stringify([s.botId,s.chatId,s.senderId]);
export function parseTelegramIdentityView(raw:unknown,tenant:string,botId:string,updateId:number):TelegramIdentityView {
 try {
  const r=tgRecord(raw);tgExact(r,['tenantId','ownerId','revision','crmRevision','connectionRevision','source','link','contact','audit']);
  const s=source(r.source);if(r.tenantId!==tenant||s.botId!==botId||s.updateId!==updateId||!Array.isArray(r.audit)||r.audit.length>20)throw 0;
  const l=r.link===null?null:link(r.link),c=r.contact===null?null:tgRecord(r.contact);if(c)tgExact(c,['id','name','status','version']);
  if(l&&(l.revokedAt!==null||l.actor!==r.ownerId||key(l.source)!==key(s))||!!l!==!!c||c&&c.id!==l!.contactId)throw 0;
  const audit=r.audit.map(raw=>{const a=tgRecord(raw);tgExact(a,['commandId','operation','linkId','contactId','actor','at','revision','source','note']);const result={commandId:crmId(a.commandId),operation:crmEnum(a.operation,['verify','revoke'] as const),linkId:crmId(a.linkId),contactId:crmId(a.contactId),actor:crmId(a.actor),at:crmTime(a.at),revision:crmRevision(a.revision),source:source(a.source),note:crmText(a.note,500,true)};if(result.actor!==r.ownerId||key(result.source)!==key(s))throw 0;return result;});
  return {tenantId:tenant,ownerId:crmId(r.ownerId),revision:crmRevision(r.revision),crmRevision:crmRevision(r.crmRevision),connectionRevision:crmRevision(r.connectionRevision),source:s,link:l,contact:c?{id:crmId(c.id),name:crmText(c.name,200),status:crmEnum(c.status,['active','archived'] as const),version:tgInt(c.version,1)}:null,audit};
 }catch{throw new TelegramError('TELEGRAM_IDENTITY_INVALID_RESPONSE');}
}
export function parseTelegramContactIdentities(raw:unknown,tenant:string,contactId:string):TelegramContactIdentities {
 try {
  const r=tgRecord(raw);tgExact(r,['tenantId','ownerId','revision','connectionRevision','contactId','items','total','truncated']);
  if(r.tenantId!==tenant||r.contactId!==contactId||!Array.isArray(r.items)||r.items.length>100||typeof r.truncated!=='boolean')throw 0;
  const items=r.items.map(link);if(items.some(i=>i.contactId!==contactId)||new Set(items.map(i=>i.id)).size!==items.length)throw 0;
  const total=crmRevision(r.total);if(total<items.length||r.truncated!==(total>items.length))throw 0;
  return {tenantId:tenant,ownerId:crmId(r.ownerId),revision:crmRevision(r.revision),connectionRevision:crmRevision(r.connectionRevision),contactId,items,total,truncated:r.truncated};
 }catch{throw new TelegramError('TELEGRAM_IDENTITY_INVALID_RESPONSE');}
}
export function parseTelegramIdentityReceipt(raw:unknown):TelegramIdentityReceipt {
 const r=tgRecord(raw);tgExact(r,['revision','decisionId','linkId']);return {revision:crmRevision(r.revision),decisionId:crmId(r.decisionId),linkId:crmId(r.linkId)};
}
