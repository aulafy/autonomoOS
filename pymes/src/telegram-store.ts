import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { TelegramError, tgInt, tgText, tgExact, tgRecord, type TelegramBot, type TelegramMessage, type TelegramPage, type TelegramStatus, type TelegramProblem } from './telegram-contract.js';
import type { TelegramInbound } from './telegram-transport.js';
export interface TelegramConnection { revision:number; enabled:boolean; bot:TelegramBot|null; allowedChatIds:string[]; credentialRef:string|null; }
export const telegramHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Bot inbox sidecar; no C1-C12 journal or credentials. One authoritative tenant/owner binding. */
export class TelegramStore {
 private db:DatabaseSync;
 constructor(path:string,readonly tenant:string,readonly owner:string,private now:()=>number=Date.now,private hooks:{beforeCommit?:()=>void;afterCommit?:()=>void}={}){
  tgText(tenant);tgText(owner);if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);
  try{
   this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');if(path!==':memory:')chmodSync(path,0o600);
   this.db.exec(`CREATE TABLE IF NOT EXISTS telegram_meta(id INTEGER PRIMARY KEY CHECK(id=1),tenant TEXT NOT NULL,owner TEXT NOT NULL,version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS telegram_vault_cleanup(ref TEXT PRIMARY KEY,after_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS telegram_profile(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS telegram_commands(id TEXT PRIMARY KEY,digest TEXT NOT NULL,revision INTEGER NOT NULL,audit TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS telegram_accounts(bot TEXT PRIMARY KEY,next_offset INTEGER,revision INTEGER NOT NULL DEFAULT 0,last_sync INTEGER,problem TEXT,retry_at INTEGER);
    CREATE TABLE IF NOT EXISTS telegram_updates(bot TEXT NOT NULL,update_id INTEGER NOT NULL,digest TEXT NOT NULL,disposition TEXT NOT NULL,value TEXT,PRIMARY KEY(bot,update_id));
    CREATE TABLE IF NOT EXISTS telegram_lease(id INTEGER PRIMARY KEY CHECK(id=1),token TEXT NOT NULL,expires INTEGER NOT NULL,revision INTEGER NOT NULL);`);
   this.tx(()=>{const row=this.db.prepare('SELECT * FROM telegram_meta WHERE id=1').get();if(row&&(row.tenant!==tenant||row.owner!==owner||row.version!==1))throw new TelegramError('TELEGRAM_SCOPE_DENIED');if(!row)this.db.prepare('INSERT INTO telegram_meta VALUES(1,?,?,1)').run(tenant,owner);},false);
  }catch(error){this.db.close();throw error;}
 }
 close(){this.db.close();}
 reserveCredential(ref:string){if(!/^[a-f0-9]{64}$/.test(ref))throw new TelegramError('TELEGRAM_INVALID_INPUT');this.db.prepare('INSERT INTO telegram_vault_cleanup VALUES(?,?)').run(ref,tgInt(this.now()+120000));}
 credentialDeleted(ref:string){this.db.prepare('DELETE FROM telegram_vault_cleanup WHERE ref=?').run(ref);}
 pendingCredentials():string[]{return this.db.prepare('SELECT ref FROM telegram_vault_cleanup WHERE after_at<=? ORDER BY after_at LIMIT 3').all(this.now()).map(r=>String(r.ref)).filter(ref=>ref!==this.connection().credentialRef);}

 scope(tenant:string,owner:string){if(tenant!==this.tenant||owner!==this.owner)throw new TelegramError('TELEGRAM_SCOPE_DENIED');}
 private tx<T>(fn:()=>T,hooks=true):T{this.db.exec('BEGIN IMMEDIATE');let result:T;try{result=fn();if(hooks)this.hooks.beforeCommit?.();this.db.exec('COMMIT');}catch(error){this.db.exec('ROLLBACK');throw error;}if(hooks)this.hooks.afterCommit?.();return result;}
 connection():TelegramConnection{const row=this.db.prepare('SELECT value FROM telegram_profile WHERE id=1').get();return row?JSON.parse(String(row.value)):{revision:0,enabled:false,bot:null,allowedChatIds:[],credentialRef:null};}
 command(id:string,digest:string):number|null{const row=this.db.prepare('SELECT digest,revision FROM telegram_commands WHERE id=?').get(id);if(!row)return null;if(row.digest!==digest)throw new TelegramError('TELEGRAM_COMMAND_CONFLICT');return Number(row.revision);}
 configure(command:{commandId:string;expectedRevision:number},digest:string,value:Omit<TelegramConnection,'revision'>):number{
  return this.tx(()=>{const previous=this.command(command.commandId,digest);if(previous!==null)return previous;
   const current=this.connection();if(current.revision!==command.expectedRevision)throw new TelegramError('TELEGRAM_REVISION_CONFLICT');
   const revision=tgInt(current.revision+1),next={...value,revision};
   if(current.credentialRef&&current.credentialRef!==next.credentialRef)this.db.prepare('INSERT OR IGNORE INTO telegram_vault_cleanup VALUES(?,?)').run(current.credentialRef,tgInt(this.now()));
   if(next.credentialRef)this.db.prepare('DELETE FROM telegram_vault_cleanup WHERE ref=?').run(next.credentialRef);
   this.db.prepare('INSERT INTO telegram_profile VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(next));
   if(next.bot){this.db.prepare('INSERT OR IGNORE INTO telegram_accounts(bot) VALUES(?)').run(next.bot.id);this.db.prepare('UPDATE telegram_accounts SET problem=NULL,retry_at=NULL WHERE bot=?').run(next.bot.id);}
   this.db.prepare('DELETE FROM telegram_lease').run();
   this.db.prepare('INSERT INTO telegram_commands VALUES(?,?,?,?)').run(command.commandId,digest,revision,JSON.stringify({id:command.commandId,actor:this.owner,at:tgInt(this.now()),revision,operation:next.enabled?'connect':'disconnect',botId:next.bot?.id??null,allowedChatIds:next.allowedChatIds}));return revision;
  });
 }
 history(){return this.db.prepare('SELECT audit FROM telegram_commands ORDER BY revision DESC LIMIT 30').all().map(r=>JSON.parse(String(r.audit)));}
 status(running=false):TelegramStatus{
  const c=this.connection(),a=c.bot?this.db.prepare('SELECT * FROM telegram_accounts WHERE bot=?').get(c.bot.id):null;
  const count=(kind:string)=>c.bot?Number(this.db.prepare(`SELECT COUNT(*) AS n FROM telegram_updates WHERE bot=? AND disposition=?${kind==='accepted'?` AND json_extract(value,'$.chatId') IN (${c.allowedChatIds.map(()=>'?').join(',')})`:''}`).get(c.bot.id,kind,...(kind==='accepted'?c.allowedChatIds:[]))?.n??0):0;
  return {tenantId:this.tenant,ownerId:this.owner,revision:c.revision,enabled:c.enabled,bot:c.bot,allowedChatIds:c.allowedChatIds,running,lastSyncAt:a?.last_sync==null?null:Number(a.last_sync),retryAt:a?.retry_at==null?null:Number(a.retry_at),problem:(a?.problem??null) as TelegramProblem,messageCount:count('accepted'),ignoredCount:count('ignored_chat')+count('unsupported')};
 }
 offset(botId:string):number|null{const r=this.db.prepare('SELECT next_offset FROM telegram_accounts WHERE bot=?').get(botId);return r?.next_offset==null?null:Number(r.next_offset);}
 acquire(revision:number):string|null{
  return this.tx(()=>{const c=this.connection();if(!c.enabled||c.revision!==revision)throw new TelegramError('TELEGRAM_CONTEXT_CHANGED');
   const old=this.db.prepare('SELECT expires FROM telegram_lease').get();if(old&&Number(old.expires)>this.now())return null;
   const token=randomUUID();this.db.prepare('INSERT INTO telegram_lease VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET token=excluded.token,expires=excluded.expires,revision=excluded.revision').run(token,tgInt(this.now()+90_000),revision);return token;
  },false);
 }
 release(token:string){this.db.prepare('DELETE FROM telegram_lease WHERE token=?').run(token);}
 private assertLease(token:string,revision:number){const c=this.connection(),lease=this.db.prepare('SELECT * FROM telegram_lease WHERE id=1').get();if(!c.enabled||c.revision!==revision||!lease||lease.token!==token||lease.revision!==revision||Number(lease.expires)<=this.now())throw new TelegramError('TELEGRAM_CONTEXT_CHANGED');return c;}
 commitBatch(token:string,revision:number,updates:TelegramInbound[],authorized:()=>boolean=()=>true){
  this.tx(()=>{const c=this.assertLease(token,revision);if(!authorized())throw new TelegramError('TELEGRAM_AUTH_CHANGED');const bot=c.bot!.id;
   let offset=this.offset(bot),changed=false;const seen=new Set<number>();
   for(const item of [...updates].sort((a,b)=>a.updateId-b.updateId)){
    if(seen.has(item.updateId))throw new TelegramError('TELEGRAM_INVALID_RESPONSE');seen.add(item.updateId);
    const digest=telegramHash(item),old=this.db.prepare('SELECT digest FROM telegram_updates WHERE bot=? AND update_id=?').get(bot,item.updateId);
    if(old){if(old.digest!==digest)throw new TelegramError('TELEGRAM_UPDATE_CONFLICT');}
    else{if(offset!==null&&item.updateId<offset)throw new TelegramError('TELEGRAM_UPDATE_CONFLICT');
     const value=item.message?JSON.stringify({...item.message,receivedAt:tgInt(this.now())}):null;
     this.db.prepare('INSERT INTO telegram_updates VALUES(?,?,?,?,?)').run(bot,item.updateId,digest,item.disposition,value);changed=true;
    }
    offset=Math.max(offset??0,item.updateId+1);
   }
   this.db.prepare('UPDATE telegram_accounts SET next_offset=?,revision=revision+?,last_sync=?,problem=NULL,retry_at=NULL WHERE bot=?').run(offset,changed?1:0,tgInt(this.now()),bot);
  });
 }
 problem(token:string,revision:number,problem:TelegramProblem,retryAt:number){this.tx(()=>{this.assertLease(token,revision);this.db.prepare('UPDATE telegram_accounts SET problem=?,retry_at=? WHERE bot=?').run(problem,tgInt(retryAt),this.connection().bot!.id);},false);}
 page(query:string,limit:number,cursor:string|null):TelegramPage{
  if(query.length>100||/[\u0000-\u001f\u007f]/.test(query)||!Number.isSafeInteger(limit)||limit<1||limit>50||cursor!==null&&cursor.length>1024)throw new TelegramError('TELEGRAM_INVALID_QUERY');
  this.db.exec('BEGIN');try{
   const c=this.connection(),bot=c.bot?.id??null,a=bot?this.db.prepare('SELECT revision FROM telegram_accounts WHERE bot=?').get(bot):null,rev=Number(a?.revision??0);let before=Number.MAX_SAFE_INTEGER;
   if(cursor!==null){try{const r=tgRecord(JSON.parse(Buffer.from(cursor,'base64url').toString()));tgExact(r,['revision','profile','before','bot','query']);if(r.revision!==rev||r.profile!==c.revision||r.bot!==bot||r.query!==query)throw 0;before=tgInt(r.before);}catch{throw new TelegramError('TELEGRAM_CURSOR_INVALID');}}
   const rows=bot?this.db.prepare(`SELECT update_id,value FROM telegram_updates WHERE bot=? AND disposition='accepted' AND json_extract(value,'$.chatId') IN (${c.allowedChatIds.map(()=>'?').join(',')}) AND update_id<? AND instr(lower(json_extract(value,'$.text')),lower(?))>0 ORDER BY update_id DESC LIMIT ?`).all(bot,...c.allowedChatIds,before,query,limit+1):[];
   const items=rows.slice(0,limit).map(r=>JSON.parse(String(r.value)) as TelegramMessage),nextCursor=rows.length>limit?Buffer.from(JSON.stringify({revision:rev,profile:c.revision,before:items.at(-1)!.updateId,bot,query})).toString('base64url'):null;
   this.db.exec('COMMIT');return {tenantId:this.tenant,ownerId:this.owner,botId:bot,revision:rev,connectionRevision:c.revision,items,nextCursor};
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
}
