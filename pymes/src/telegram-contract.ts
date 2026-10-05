/** Shared Bot API inbound contract. No personal account access or send capability. */
export class TelegramError extends Error { constructor(code: string, readonly retryMs=0) { super(code); this.name = 'TelegramError'; } }
export function tgError(code = 'TELEGRAM_INVALID_INPUT'): never { throw new TelegramError(code); }
export function tgRecord(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) return tgError(); return v as Record<string, unknown>; }
export function tgExact(r: Record<string, unknown>, keys: string[]) { if (Object.keys(r).sort().join(',') !== [...keys].sort().join(',')) tgError(); }
export function tgInt(v: unknown, min = 0): number { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) return tgError(); return v; }
export function tgText(v: unknown, max = 200): string { if (typeof v !== 'string' || !v.trim() || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) return tgError(); return v.trim(); }
export function tgChat(v: unknown): string { if (typeof v !== 'string' || !/^-?[1-9]\d{0,15}$/.test(v) || !Number.isSafeInteger(Number(v))) return tgError(); return v; }
export interface TelegramBot { id: string; username: string; name: string; }
export interface TelegramConfigInput { commandId: string; expectedRevision: number; token: string; allowedChatIds: string[]; consent: true; }
export interface TelegramDecisionInput { commandId: string; expectedRevision: number; }
export function parseTelegramDecision(raw: unknown): TelegramDecisionInput {
 const r = tgRecord(raw); tgExact(r, ['commandId','expectedRevision']); const commandId = tgText(r.commandId,100);
 if (!/^[a-zA-Z0-9_-]+$/.test(commandId)) tgError(); return { commandId, expectedRevision: tgInt(r.expectedRevision) };
}
export function parseTelegramConfig(raw: unknown): TelegramConfigInput {
 const r = tgRecord(raw); tgExact(r,['commandId','expectedRevision','token','allowedChatIds','consent']);
 const base = parseTelegramDecision({commandId:r.commandId,expectedRevision:r.expectedRevision});
 if (typeof r.token !== 'string' || !/^[1-9]\d{4,19}:[a-zA-Z0-9_-]{20,150}$/.test(r.token) || r.consent !== true || !Array.isArray(r.allowedChatIds) || r.allowedChatIds.length < 1 || r.allowedChatIds.length > 100) tgError();
 const allowedChatIds = r.allowedChatIds.map(tgChat).sort(); if (new Set(allowedChatIds).size !== allowedChatIds.length) tgError();
 return {...base,token:r.token,allowedChatIds,consent:true};
}
export interface TelegramMessage { botId:string; updateId:number; messageId:number; chatId:string; senderId:string; senderName:string; at:number; receivedAt:number; text:string; edited:boolean; }
export type TelegramProblem = 'TELEGRAM_AUTH_REQUIRED'|'TELEGRAM_NETWORK_ERROR'|'TELEGRAM_INVALID_RESPONSE'|'TELEGRAM_RATE_LIMIT'|'TELEGRAM_WEBHOOK_ACTIVE'|'TELEGRAM_POLL_CONFLICT'|'TELEGRAM_CREDENTIAL_UNAVAILABLE'|'TELEGRAM_UPDATE_CONFLICT'|null;
export interface TelegramStatus { tenantId:string; ownerId:string; revision:number; enabled:boolean; bot:TelegramBot|null; allowedChatIds:string[]; running:boolean; lastSyncAt:number|null; retryAt:number|null; problem:TelegramProblem; messageCount:number; ignoredCount:number; }
export interface TelegramPage { tenantId:string; ownerId:string; botId:string|null; revision:number; connectionRevision:number; items:TelegramMessage[]; nextCursor:string|null; }
export function parseTelegramStatus(raw:unknown,tenant:string):TelegramStatus {
 const r=tgRecord(raw);tgExact(r,['tenantId','ownerId','revision','enabled','bot','allowedChatIds','running','lastSyncAt','retryAt','problem','messageCount','ignoredCount']);
 if(r.tenantId!==tenant||typeof r.enabled!=='boolean'||typeof r.running!=='boolean'||!Array.isArray(r.allowedChatIds))tgError();
 const bot=r.bot===null?null:tgRecord(r.bot); if(bot)tgExact(bot,['id','username','name']);
 const allowedChatIds=r.allowedChatIds.map(tgChat); if(allowedChatIds.length>100||new Set(allowedChatIds).size!==allowedChatIds.length)tgError();
 const problems=[null,'TELEGRAM_AUTH_REQUIRED','TELEGRAM_NETWORK_ERROR','TELEGRAM_INVALID_RESPONSE','TELEGRAM_RATE_LIMIT','TELEGRAM_WEBHOOK_ACTIVE','TELEGRAM_POLL_CONFLICT','TELEGRAM_CREDENTIAL_UNAVAILABLE','TELEGRAM_UPDATE_CONFLICT'];if(!problems.includes(r.problem as string|null))tgError();
 if(r.enabled&&(!bot||!allowedChatIds.length))tgError();
 return {tenantId:tenant,ownerId:tgText(r.ownerId),revision:tgInt(r.revision),enabled:r.enabled,bot:bot?{id:tgChat(bot.id),username:tgText(bot.username),name:tgText(bot.name)}:null,allowedChatIds,running:r.running,lastSyncAt:r.lastSyncAt===null?null:tgInt(r.lastSyncAt),retryAt:r.retryAt===null?null:tgInt(r.retryAt),problem:r.problem as TelegramProblem,messageCount:tgInt(r.messageCount),ignoredCount:tgInt(r.ignoredCount)};
}
export function parseTelegramMessage(raw:unknown):TelegramMessage {
 const r=tgRecord(raw);tgExact(r,['botId','updateId','messageId','chatId','senderId','senderName','at','receivedAt','text','edited']);
 if(typeof r.text!=='string'||r.text.length>4096||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(r.text)||typeof r.edited!=='boolean')tgError();
 return {botId:tgChat(r.botId),updateId:tgInt(r.updateId),messageId:tgInt(r.messageId,1),chatId:tgChat(r.chatId),senderId:tgChat(r.senderId),senderName:tgText(r.senderName),at:tgInt(r.at),receivedAt:tgInt(r.receivedAt),text:r.text,edited:r.edited};
}
export function parseTelegramPage(raw:unknown,tenant:string):TelegramPage {
 const r=tgRecord(raw);tgExact(r,['tenantId','ownerId','botId','revision','connectionRevision','items','nextCursor']);
 if(r.tenantId!==tenant||!Array.isArray(r.items)||r.items.length>50||r.nextCursor!==null&&(typeof r.nextCursor!=='string'||r.nextCursor.length>1024))tgError();
 const botId=r.botId===null?null:tgChat(r.botId),items=r.items.map(parseTelegramMessage);let prev=Infinity;
 for(const item of items){if(item.botId!==botId||item.updateId>=prev)tgError();prev=item.updateId;}
 return {tenantId:tenant,ownerId:tgText(r.ownerId),botId,revision:tgInt(r.revision),connectionRevision:tgInt(r.connectionRevision),items,nextCursor:r.nextCursor as string|null};
}
