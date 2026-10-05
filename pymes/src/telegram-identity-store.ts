import {createHash} from 'node:crypto';
import {crmId,crmTime} from './crm-contract.js';
import {TelegramError,tgInt,tgChat} from './telegram-contract.js';
import {parseTelegramIdentityCommand,type TelegramIdentityCommand,type TelegramIdentitySource,type TelegramIdentityLink,type TelegramIdentityAudit,type TelegramIdentityReceipt} from './telegram-identity-contract.js';
interface State {revision:number;links:TelegramIdentityLink[];audit:TelegramIdentityAudit[];commands:Record<string,{digest:string;result:TelegramIdentityReceipt}>;}
const fresh=():State=>({revision:0,links:[],audit:[],commands:{}});
export const telegramIdentityDigest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const key=(s:TelegramIdentitySource)=>JSON.stringify([s.botId,s.chatId,s.senderId]);
/** Independent journal projection. Incoming names/text never prove identity. */
export class TelegramIdentityStore {
 private states=new Map<string,State>();
 constructor(readonly tenant:string){crmId(tenant);}
 private state(owner:string){crmId(owner);return this.states.get(owner)??fresh();}
 revision(owner:string){return this.state(owner).revision;}
 receipt(owner:string,input:TelegramIdentityCommand):TelegramIdentityReceipt|null {
  const commands=this.state(owner).commands,old=Object.hasOwn(commands,input.commandId)?commands[input.commandId]:undefined;if(!old)return null;
  if(old.digest!==telegramIdentityDigest(input))throw new TelegramError('TELEGRAM_IDENTITY_COMMAND_CONFLICT');return structuredClone(old.result);
 }
 current(owner:string,source:TelegramIdentitySource){return structuredClone(this.state(owner).links.find(l=>key(l.source)===key(source)&&l.revokedAt===null)??null);}
 audit(owner:string,source:TelegramIdentitySource){return structuredClone(this.state(owner).audit.filter(a=>key(a.source)===key(source)).slice(-20).reverse());}
 forContact(owner:string,contactId:string,botId:string|null,chats:string[]){const rows=this.state(owner).links.filter(l=>l.contactId===contactId&&l.source.botId===botId&&chats.includes(l.source.chatId)).slice().reverse();return {items:structuredClone(rows.slice(0,100)),total:rows.length,truncated:rows.length>100};}
 apply(raw:{tenant:string;owner:string;input:TelegramIdentityCommand;source:TelegramIdentitySource;contactVersion:number;at:number}):TelegramIdentityReceipt {
  if(raw.tenant!==this.tenant)throw new TelegramError('TELEGRAM_SCOPE_DENIED');const input=parseTelegramIdentityCommand(raw.input),owner=crmId(raw.owner),at=crmTime(raw.at);
  const s=raw.source;tgChat(s.botId);tgChat(s.chatId);tgChat(s.senderId);tgInt(s.messageId,1);tgInt(s.updateId);
  if(s.botId!==input.botId||s.updateId!==input.updateId)throw new TelegramError('TELEGRAM_IDENTITY_SOURCE_CHANGED');
  const prior=this.receipt(owner,input);if(prior)return prior;
  const current=this.state(owner);if(current.revision!==input.expectedRevision)throw new TelegramError('TELEGRAM_IDENTITY_REVISION_CONFLICT');
  const next=structuredClone(current),active=next.links.find(l=>key(l.source)===key(s)&&l.revokedAt===null);let id:string,contactId:string;
  if(input.operation==='verify'){
   if(active)throw new TelegramError('TELEGRAM_IDENTITY_ALREADY_VERIFIED');tgInt(raw.contactVersion,1);
   id=telegramIdentityDigest(['telegram-link',owner,input.commandId]);contactId=input.contactId!;
   next.links.push({id,contactId,contactVersion:raw.contactVersion,source:structuredClone(s),verifiedAt:at,actor:owner,note:input.note,revokedAt:null,revokedBy:null});
  }else{
   if(!active||active.id!==input.linkId)throw new TelegramError('TELEGRAM_IDENTITY_LINK_CHANGED');id=active.id;contactId=active.contactId;active.revokedAt=at;active.revokedBy=owner;
  }
  if(next.links.length>=10000||next.audit.length>=20000)throw new TelegramError('TELEGRAM_IDENTITY_CAPACITY_REACHED');
  next.revision++;next.audit.push({commandId:input.commandId,operation:input.operation,linkId:id,contactId,actor:owner,at,revision:next.revision,source:structuredClone(s),note:input.note});
  const result={revision:next.revision,decisionId:input.commandId,linkId:id};next.commands[input.commandId]={digest:telegramIdentityDigest(input),result};this.states.set(owner,next);return structuredClone(result);
 }
}
