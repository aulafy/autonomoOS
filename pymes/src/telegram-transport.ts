import { TelegramError, tgRecord, tgChat, tgInt, tgText, type TelegramBot, type TelegramMessage } from './telegram-contract.js';
async function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
 signal.throwIfAborted();let listener:()=>void=()=>{};
 const stopped=new Promise<never>((_,reject)=>{listener=()=>reject(new Error('ABORTED'));signal.addEventListener('abort',listener,{once:true});});
 try{return await Promise.race([promise,stopped]);}finally{signal.removeEventListener('abort',listener);}
}
/** Fixed HTTPS destination, bounded bodies, no redirects, no arbitrary method or sender. */
export class TelegramBotReader {
 constructor(private fetcher:typeof fetch=fetch) {}
 private async call(token:string,method:'getMe'|'getWebhookInfo'|'getUpdates',body:Record<string,unknown>,signal?:AbortSignal):Promise<unknown>{
  if(!/^[1-9]\d{4,19}:[a-zA-Z0-9_-]{20,150}$/.test(token))throw new TelegramError('TELEGRAM_AUTH_REQUIRED');
  const deadline=signal?AbortSignal.any([signal,AbortSignal.timeout(30_000)]):AbortSignal.timeout(30_000);
  let response:Response;
  try{response=await abortable(this.fetcher(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:deadline}),deadline);}
  catch{throw new TelegramError('TELEGRAM_NETWORK_ERROR');}
  if(response.status===401||response.status===403)throw new TelegramError('TELEGRAM_AUTH_REQUIRED');
  if(response.status===409)throw new TelegramError('TELEGRAM_POLL_CONFLICT');
  const rateLimited=response.status===429;
  const retry=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=2147483?Math.max(60_000,value*1000):60_000;
  if(!response.ok&&!rateLimited)throw new TelegramError('TELEGRAM_NETWORK_ERROR');
  try{
   if(!response.body)throw 0;const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
   try{for(;;){const {done,value}=await abortable(reader.read(),deadline);if(done)break;size+=value.length;if(size>1_048_576)throw 0;chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   const data=tgRecord(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
   if(rateLimited||data.ok!==true){if(rateLimited||data.error_code===429){const params=data.parameters;const wait=params&&typeof params==='object'?(params as Record<string,unknown>).retry_after:undefined;throw new TelegramError('TELEGRAM_RATE_LIMIT',retry(wait));}if(data.error_code===401||data.error_code===403)throw new TelegramError('TELEGRAM_AUTH_REQUIRED');if(data.error_code===409)throw new TelegramError('TELEGRAM_POLL_CONFLICT');if(data.error_code===429)throw new TelegramError('TELEGRAM_RATE_LIMIT');throw 0;}
   return data.result;
  }catch(error){if(error instanceof TelegramError&&error.message!=='TELEGRAM_INVALID_INPUT')throw error;if(rateLimited)throw new TelegramError('TELEGRAM_RATE_LIMIT',retry(Number(response.headers.get('retry-after'))));throw new TelegramError('TELEGRAM_INVALID_RESPONSE');}
 }
 async identity(token:string,signal?:AbortSignal):Promise<TelegramBot>{
  try{const r=tgRecord(await this.call(token,'getMe',{},signal));if(r.is_bot!==true)throw 0;
   const bot={id:tgChat(String(tgInt(r.id,1))),username:tgText(r.username),name:tgText(r.first_name)};
   if(!/^[a-zA-Z0-9_]{5,32}$/.test(bot.username))throw 0;
   const webhook=tgRecord(await this.call(token,'getWebhookInfo',{},signal));if(typeof webhook.url!=='string')throw 0;if(webhook.url)throw new TelegramError('TELEGRAM_WEBHOOK_ACTIVE');return bot;
  }catch(error){if(error instanceof TelegramError&&error.message!=='TELEGRAM_INVALID_INPUT')throw error;throw new TelegramError('TELEGRAM_INVALID_RESPONSE');}
 }
 async updates(token:string,offset:number|null,signal?:AbortSignal):Promise<unknown[]>{
  const r=await this.call(token,'getUpdates',{...(offset===null?{}:{offset}),limit:100,timeout:20,allowed_updates:['message','edited_message']},signal);
  if(!Array.isArray(r)||r.length>100)throw new TelegramError('TELEGRAM_INVALID_RESPONSE');return r;
 }
}
export interface TelegramInbound { updateId:number; disposition:'accepted'|'ignored_chat'|'unsupported'; message:Omit<TelegramMessage,'receivedAt'>|null; }
/** Unknown updates are acknowledged as unsupported; denied content is never persisted. */
export function normalizeTelegramUpdate(raw:unknown,botId:string,allowedChatIds:string[]):TelegramInbound{
 try{
  const r=tgRecord(raw),updateId=tgInt(r.update_id);if(updateId===Number.MAX_SAFE_INTEGER)throw 0;
  const edited=r.edited_message!==undefined;if(r.message!==undefined&&edited)throw 0;
  const source=r.message??r.edited_message;if(source===undefined)return {updateId,disposition:'unsupported',message:null};
  const m=tgRecord(source),chat=tgRecord(m.chat),chatId=tgChat(String(tgInt(chat.id,Number.MIN_SAFE_INTEGER)));if(!['private','group','supergroup'].includes(String(chat.type)))return {updateId,disposition:'unsupported',message:null};
  if(!allowedChatIds.includes(chatId))return {updateId,disposition:'ignored_chat',message:null};
  if(typeof m.text!=='string')return {updateId,disposition:'unsupported',message:null};
  const sender=tgRecord(m.from);if(sender.is_bot!==false)return {updateId,disposition:'unsupported',message:null};
  const text=m.text;if(text.length>4096||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))throw 0;
  const senderName=tgText([sender.first_name,sender.last_name].filter(v=>typeof v==='string').join(' '));
  return {updateId,disposition:'accepted',message:{botId,updateId,messageId:tgInt(m.message_id,1),chatId,senderId:tgChat(String(tgInt(sender.id,1))),senderName,at:tgInt(tgInt(edited?m.edit_date:m.date)*1000),text,edited}};
 }catch{throw new TelegramError('TELEGRAM_INVALID_RESPONSE');}
}
