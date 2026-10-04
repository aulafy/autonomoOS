import { crmRecord, crmText, crmEnum, crmId, crmRef, crmTime, crmRevision } from './crm-contract.js';
export const MAIL_TOPICS = ['incident','quote','renewal','appointment','service','unknown'] as const;
export const MAIL_LINES = ['car','life','home','professional_liability','unknown'] as const;
export interface MailProposal {
  topic: typeof MAIL_TOPICS[number]; line: typeof MAIL_LINES[number]; priority: 'normal'|'high'|'urgent';
  summary: string; reason: string; missingInformation: string[]; evidenceQuotes: string[]; draft: { subject: string; body: string };
}
export interface SavedMailProposal {
  id: string; sourceHash: string; proposal: MailProposal; provider: string; model: string; latencyMs: number;
  createdAt: number; inputTruncated: boolean; state: 'proposed'|'accepted'|'rejected'; reviewedAt: number|null;
}
export interface MailAssistanceView { tenantId: string; accountRef: string; gmailId: string; proposal: SavedMailProposal|null; localOnly: true }
function exact(v: Record<string,unknown>, keys: string[]) { if (Object.keys(v).sort().join(',') !== keys.sort().join(',')) throw new Error('MAIL_AI_INVALID_PROPOSAL'); }
function strings(value: unknown, max: number, chars: number) { if (!Array.isArray(value) || value.length > max) throw new Error('MAIL_AI_INVALID_PROPOSAL'); return value.map(v=>crmText(v,chars)); }
export function parseMailProposal(raw: unknown): MailProposal {
  const p=crmRecord(raw); exact(p,['topic','line','priority','summary','reason','missingInformation','evidenceQuotes','draft']);
  const d=crmRecord(p.draft);exact(d,['subject','body']);
  return {topic:crmEnum(p.topic,MAIL_TOPICS),line:crmEnum(p.line,MAIL_LINES),priority:crmEnum(p.priority,['normal','high','urgent']),summary:crmText(p.summary,1000),reason:crmText(p.reason,400),missingInformation:strings(p.missingInformation,8,200),evidenceQuotes:strings(p.evidenceQuotes,5,240),draft:{subject:crmText(d.subject,300),body:crmText(d.body,4000)}};
}
export function parseSavedMailProposal(raw: unknown): SavedMailProposal {
  const p=crmRecord(raw);exact(p,['id','sourceHash','proposal','provider','model','latencyMs','createdAt','inputTruncated','state','reviewedAt']);
  if(typeof p.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(p.sourceHash)||typeof p.inputTruncated!=='boolean')throw new Error('MAIL_AI_INVALID_PROPOSAL');
  const state=crmEnum(p.state,['proposed','accepted','rejected']);const reviewedAt=p.reviewedAt===null?null:crmTime(p.reviewedAt);
  if((state==='proposed')!==(reviewedAt===null))throw new Error('MAIL_AI_INVALID_PROPOSAL');
  return {id:crmId(p.id),sourceHash:p.sourceHash,proposal:parseMailProposal(p.proposal),provider:crmText(p.provider,120),model:crmText(p.model,120),latencyMs:crmRevision(p.latencyMs),createdAt:crmTime(p.createdAt),inputTruncated:p.inputTruncated,state,reviewedAt};
}
export function parseMailAssistanceView(raw:unknown,tenant:string,accountRef:string,gmailId:string):MailAssistanceView {
  const p=crmRecord(raw);if(p.tenantId!==tenant||p.accountRef!==crmRef(accountRef)||p.gmailId!==crmId(gmailId)||p.localOnly!==true)throw new Error('MAIL_AI_INVALID_RESPONSE');
  return {tenantId:tenant,accountRef,gmailId,localOnly:true,proposal:p.proposal===null?null:parseSavedMailProposal(p.proposal)};
}
const text=(max:number)=>({type:'string',minLength:1,maxLength:max});
export const MAIL_PROPOSAL_SCHEMA:Record<string,unknown>={type:'object',additionalProperties:false,required:['topic','line','priority','summary','reason','missingInformation','evidenceQuotes','draft'],properties:{topic:{type:'string',enum:MAIL_TOPICS},line:{type:'string',enum:MAIL_LINES},priority:{type:'string',enum:['normal','high','urgent']},summary:text(1000),reason:text(400),missingInformation:{type:'array',maxItems:8,items:text(200)},evidenceQuotes:{type:'array',maxItems:5,items:text(240)},draft:{type:'object',additionalProperties:false,required:['subject','body'],properties:{subject:text(300),body:text(4000)}}}};
