import { randomUUID, createHash } from 'node:crypto';
import type { CredentialVault } from './gmail-keychain.js';
import { parseTelegramConfig, parseTelegramDecision, TelegramError, type TelegramConfigInput, type TelegramProblem } from './telegram-contract.js';
import { TelegramBotReader, normalizeTelegramUpdate } from './telegram-transport.js';
import { TelegramStore, telegramHash } from './telegram-store.js';
/** Inbound shared connector. Configuration secrets go only to CredentialVault. */
export class TelegramService {
 private running:Promise<void>|null=null;private abort:AbortController|null=null;private timer:ReturnType<typeof setTimeout>|null=null;
 private changing=false;private closed=false;private auto=false;private cleanup:Promise<void>|null=null;private cleanupTimer:ReturnType<typeof setTimeout>|null=null;
 readonly reader:TelegramBotReader;
 constructor(readonly store:TelegramStore,private vault:CredentialVault,fetcher:typeof fetch=fetch,private now:()=>number=Date.now){this.reader=new TelegramBotReader(fetcher);}
 status(){return this.store.status(!!this.running);}
 private live(authorized:()=>boolean){if(this.closed||!authorized())throw new TelegramError('TELEGRAM_AUTH_CHANGED');}
 async configure(raw:unknown,authorized:()=>boolean=()=>true){
  const input=parseTelegramConfig(raw),digest=telegramHash({operation:'connect',input});this.live(authorized);
  if(this.changing)throw new TelegramError('TELEGRAM_BUSY');
  const prior=this.store.command(input.commandId,digest);if(prior!==null)return {decisionRevision:prior,...this.status()};
  this.changing=true;let ref:string|null=null;
  try{
   await this.stopPoll();this.live(authorized);const old=this.store.connection();if(old.revision!==input.expectedRevision)throw new TelegramError('TELEGRAM_REVISION_CONFLICT');
   const bot=await this.reader.identity(input.token);this.live(authorized);
   ref=createHash('sha256').update(`autonomo-os:telegram:${this.store.tenant}:${this.store.owner}:${randomUUID()}`).digest('hex');
   this.store.reserveCredential(ref);
   try{await this.vault.set(ref,input.token);}catch{throw new TelegramError('TELEGRAM_CREDENTIAL_UNAVAILABLE');}
   this.live(authorized);
   const revision=this.store.configure(input,digest,{enabled:true,bot,allowedChatIds:input.allowedChatIds,credentialRef:ref});ref=null;
   // Old references are no longer reachable. A Keychain deletion failure must not undo a committed decision.
   if(old.credentialRef)await this.deleteCredential(old.credentialRef);
   return {decisionRevision:revision,...this.status()};
  }finally{if(ref)await this.deleteCredential(ref);this.changing=false;this.schedule();}
 }
 async disconnect(raw:unknown,authorized:()=>boolean=()=>true){
  const input=parseTelegramDecision(raw),digest=telegramHash({operation:'disconnect',input});this.live(authorized);
  if(this.changing)throw new TelegramError('TELEGRAM_BUSY');const prior=this.store.command(input.commandId,digest);if(prior!==null)return {decisionRevision:prior,...this.status()};
  this.changing=true;
  try{await this.stopPoll();this.live(authorized);const old=this.store.connection();
   const revision=this.store.configure(input,digest,{...old,enabled:false,credentialRef:null});
   if(old.credentialRef)await this.deleteCredential(old.credentialRef);return {decisionRevision:revision,...this.status()};
  }finally{this.changing=false;this.schedule();}
 }
 sync(authorized:()=>boolean=()=>true):Promise<void>{
  this.live(authorized);if(this.changing)throw new TelegramError('TELEGRAM_BUSY');if(this.running)return this.running;
  const c=this.store.connection();if(!c.enabled||!c.bot||!c.credentialRef)throw new TelegramError('TELEGRAM_NOT_CONNECTED');
  const retryAt=this.status().retryAt;if(retryAt!==null&&retryAt>this.now())throw new TelegramError('TELEGRAM_BACKOFF');
  const lease=this.store.acquire(c.revision);if(!lease)throw new TelegramError('TELEGRAM_BUSY');
  this.abort=new AbortController();const signal=this.abort.signal;
  const work=async()=>{
   try{
    let token:string|null;try{token=await this.vault.get(c.credentialRef!);}catch{throw new TelegramError('TELEGRAM_CREDENTIAL_UNAVAILABLE');}
    if(!token)throw new TelegramError('TELEGRAM_CREDENTIAL_UNAVAILABLE');signal.throwIfAborted();this.live(authorized);
    const identity=await this.reader.identity(token,signal);if(identity.id!==c.bot!.id)throw new TelegramError('TELEGRAM_AUTH_REQUIRED');signal.throwIfAborted();this.live(authorized);
    const updates=await this.reader.updates(token,this.store.offset(c.bot!.id),signal);signal.throwIfAborted();this.live(authorized);
    const batch=updates.map(r=>normalizeTelegramUpdate(r,c.bot!.id,c.allowedChatIds));
    this.store.commitBatch(lease,c.revision,batch,()=>!signal.aborted&&!this.closed&&authorized());
   }catch(error){
    if(!signal.aborted&&!this.closed){const known:TelegramProblem[]=['TELEGRAM_AUTH_REQUIRED','TELEGRAM_NETWORK_ERROR','TELEGRAM_INVALID_RESPONSE','TELEGRAM_RATE_LIMIT','TELEGRAM_WEBHOOK_ACTIVE','TELEGRAM_POLL_CONFLICT','TELEGRAM_CREDENTIAL_UNAVAILABLE','TELEGRAM_UPDATE_CONFLICT'];
     const code=error instanceof TelegramError&&known.includes(error.message as TelegramProblem)?error.message as TelegramProblem:'TELEGRAM_NETWORK_ERROR';
     try{this.store.problem(lease,c.revision,code,this.now()+Math.max(60_000,error instanceof TelegramError?error.retryMs:0));}catch{/* Superseded writer has no right to publish status. */}
    }
   }finally{this.store.release(lease);}
  };
  this.running=work().finally(()=>{this.running=null;this.abort=null;this.schedule();});return this.running;
 }
 start(){if(this.closed||this.auto)return;this.auto=true;this.cleanupCycle();this.schedule(0);}
 private cleanupCycle(){if(!this.auto||this.closed)return;void this.flushCleanup().catch(()=>{}).finally(()=>{if(!this.auto||this.closed)return;this.cleanupTimer=setTimeout(()=>{this.cleanupTimer=null;this.cleanupCycle();},60_000);this.cleanupTimer.unref();});}
 private async deleteCredential(ref:string){try{await this.vault.delete(ref);this.store.credentialDeleted(ref);}catch{/* Durable outbox retries only obsolete references. */}}
 private flushCleanup():Promise<void>{if(this.cleanup)return this.cleanup;this.cleanup=(async()=>{for(const ref of this.store.pendingCredentials())await this.deleteCredential(ref);})().finally(()=>{this.cleanup=null;});return this.cleanup;}
 private schedule(delay=1000){if(!this.auto||this.closed||this.changing||this.running)return;if(this.timer)clearTimeout(this.timer);
  const status=this.status();if(!status.enabled||['TELEGRAM_AUTH_REQUIRED','TELEGRAM_CREDENTIAL_UNAVAILABLE','TELEGRAM_WEBHOOK_ACTIVE','TELEGRAM_POLL_CONFLICT'].includes(status.problem??''))return;
  const wait=Math.max(delay,(status.retryAt??0)-this.now());this.timer=setTimeout(()=>{this.timer=null;try{void this.sync().catch(()=>{});}catch{this.schedule(5000);}},Math.min(wait,2_147_483_647));this.timer.unref();
 }
 private async stopPoll(){if(this.timer){clearTimeout(this.timer);this.timer=null;}this.abort?.abort();await this.running;}
 async close(){this.auto=false;this.closed=true;if(this.cleanupTimer)clearTimeout(this.cleanupTimer);this.cleanupTimer=null;await this.stopPoll();await this.cleanup;this.store.close();}
}
