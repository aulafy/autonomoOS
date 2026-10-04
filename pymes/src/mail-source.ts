import {createHash} from 'node:crypto';
import type {StoredMessage} from './inbox-store.js';
/** Versioned, shared identity for both proposal review and source-bound dispatch. */
export const MAIL_ASSISTANCE_PROMPT_VERSION='2026-10-04-v3';
export function mailSourceHash(accountRef:string,m:StoredMessage){
 return createHash('sha256').update(JSON.stringify({promptVersion:MAIL_ASSISTANCE_PROMPT_VERSION,accountRef,gmailId:m.gmailId,subject:m.subject,body:m.bodyText,labels:m.labels.slice().sort(),quality:m.quality,from:m.from,to:m.to,replyTo:m.replyTo,threadId:m.threadId,messageId:m.messageId,references:m.references})).digest('hex');
}
