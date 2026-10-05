import type {JournalKernel} from '@agent-world/runtime-store-sqlite';
import type {CrmService} from './crm-service.js';
import type {TelegramService} from './telegram-service.js';
import {TelegramError} from './telegram-contract.js';
import {crmId} from './crm-contract.js';
import {parseTelegramIdentityCommand,type TelegramIdentitySource,type TelegramIdentityView,type TelegramContactIdentities} from './telegram-identity-contract.js';
import {TelegramIdentityStore} from './telegram-identity-store.js';
export class TelegramIdentityService {
 private closed=false;
 close(){this.closed=true;}
 constructor(readonly store:TelegramIdentityStore,private journal:JournalKernel,private crm:CrmService,private telegram:TelegramService,private hooks:{beforePersist?:()=>void;afterTransition?:()=>void;afterPersist?:()=>void}={}){}
 private ready(tenant:string,owner:string,live:()=>boolean){this.telegram.store.scope(tenant,owner);if(this.closed||!this.journal.isHealthy())throw new TelegramError('TELEGRAM_IDENTITY_NOT_READY');if(!live())throw new TelegramError('TELEGRAM_AUTH_CHANGED');}
 private evidence(updateId:number){const m=this.telegram.store.message(updateId);if(!m)throw new TelegramError('TELEGRAM_IDENTITY_MESSAGE_UNAVAILABLE');return {botId:m.botId,chatId:m.chatId,senderId:m.senderId,messageId:m.messageId,updateId:m.updateId};}
 view(tenant:string,owner:string,botId:string,updateId:number,live:()=>boolean):TelegramIdentityView {
  this.ready(tenant,owner,live);return this.telegram.store.readContext(botId,null,()=>{const source=this.evidence(updateId);if(source.botId!==botId)throw new TelegramError('TELEGRAM_IDENTITY_SOURCE_CHANGED');
  const link=this.store.current(owner,source),c=link?this.crm.store.contact(owner,link.contactId):null;
  if(link&&!c)throw new TelegramError('TELEGRAM_IDENTITY_CONTACT_UNAVAILABLE');
  return {tenantId:tenant,ownerId:owner,revision:this.store.revision(owner),crmRevision:this.crm.store.revision(owner),connectionRevision:this.telegram.status().revision,source,link,contact:c?{id:c.id,name:c.name,status:c.status,version:c.version}:null,audit:this.store.audit(owner,source)};});
 }
 contacts(tenant:string,owner:string,contactId:string,live:()=>boolean):TelegramContactIdentities {
  this.ready(tenant,owner,live);crmId(contactId);if(!this.crm.store.contact(owner,contactId))throw new TelegramError('TELEGRAM_IDENTITY_CONTACT_UNAVAILABLE');
  return this.telegram.store.readContext(null,null,()=>{const c=this.telegram.status();return {tenantId:tenant,ownerId:owner,contactId,revision:this.store.revision(owner),connectionRevision:c.revision,...this.store.forContact(owner,contactId,c.bot?.id??null,c.allowedChatIds)};});
 }
 command(tenant:string,owner:string,raw:unknown,live:()=>boolean){
  this.ready(tenant,owner,live);const input=parseTelegramIdentityCommand(raw),prior=this.store.receipt(owner,input);if(prior)return prior;
  return this.telegram.store.readContext(input.botId,input.connectionRevision,()=>{const c=this.telegram.status();if(c.revision!==input.connectionRevision||c.bot?.id!==input.botId)throw new TelegramError('TELEGRAM_IDENTITY_CONNECTION_CHANGED');
  if(this.crm.store.revision(owner)!==input.crmRevision)throw new TelegramError('TELEGRAM_IDENTITY_CRM_CHANGED');
  const source=this.evidence(input.updateId),contact=input.contactId?this.crm.store.contact(owner,input.contactId):null;
  if(input.operation==='verify'&&(!contact||contact.status!=='active'))throw new TelegramError('TELEGRAM_IDENTITY_CONTACT_UNAVAILABLE');
  this.ready(tenant,owner,live);this.hooks.beforePersist?.();
  const result=this.journal.transaction(()=>{this.ready(tenant,owner,live);const r=this.store.apply({tenant,owner,input,source,contactVersion:contact?.version??0,at:Date.now()});this.hooks.afterTransition?.();return r;});
  this.hooks.afterPersist?.();return result;});
 }
}
