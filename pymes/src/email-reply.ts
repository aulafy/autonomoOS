import type {EmailPayload} from './email-provider.js';
/** Browser-safe strict reply headers: no folding or injected control characters. */
export function validateEmailReply(raw:unknown):NonNullable<EmailPayload['reply']>{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('INVALID_EMAIL_REPLY');
 const r=raw as Record<string,unknown>;
 const mid=(v:unknown)=>typeof v==='string'&&v.length<=200&&/^<[^<>\s@]+@[^<>\s@]+>$/.test(v)&&/^[\x21-\x7e]+$/.test(v);
 if(Object.keys(r).sort().join(',')!=='inReplyTo,references,threadId'||typeof r.threadId!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(r.threadId)||!mid(r.inReplyTo)||typeof r.references!=='string'||r.references.length>900||r.references.split(' ').length>10||!r.references.split(' ').every(mid)||r.references.split(' ').at(-1)!==r.inReplyTo)throw new Error('INVALID_EMAIL_REPLY');
 return structuredClone(r) as NonNullable<EmailPayload['reply']>;
}
