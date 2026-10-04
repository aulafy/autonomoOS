import {parseMailCancellation,parseMailCancellationState} from './mail-cancellation-contract.js';
import type { EmailWorkflowView } from "./email-workflow.js";
import {parseMailTaskBinding} from './mail-task-contract.js';
import {validateEmailReply} from './email-reply.js';
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const hash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown, max = 10000): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
export function parseEmailView(
  value: unknown,
  tenantId: string,
  taskId: string,
): EmailWorkflowView {
  const fail = () => {
    throw new Error("INVALID_EMAIL_VIEW");
  };
  if (
    !object(value) ||
    value.tenantId !== tenantId ||
    value.taskId !== taskId ||
    typeof value.simulated !== "boolean" ||
    !text(value.status, 100) ||
    !Array.isArray(value.effects) ||
    value.effects.length > 10 ||
    !Array.isArray(value.audit) ||
    value.audit.length > 1000
  )
    return fail();
  if(value.source!==undefined&&value.source!==null){try{const source=parseMailTaskBinding(value.source);if(source.taskId!==taskId)return fail();}catch{return fail();}}
  try{
    if(value.cancellationState!==undefined&&value.cancellationState!==null)parseMailCancellationState(value.cancellationState);
    if(value.cancellation!==undefined&&value.cancellation!==null){const c=parseMailCancellation(value.cancellation);if(c.taskId!==taskId||c.tenantId!==tenantId||value.status!=='cancelled'||c.owner!==(object(value.source)?value.source.owner:null))return fail();}
    if(value.canReprepare!==undefined&&(typeof value.canReprepare!=='boolean'||value.canReprepare&&(!value.cancellation||value.status!=='cancelled'||value.replacementTaskId||value.effects.length)))return fail();
    if(object(value.cancellationState)&&value.cancellationState.canCancel&&(!object(value.source)||value.effects.length||value.status==='cancelled'||value.globalTaskStatus==='unknown'||value.globalTaskStatus==='completed'))return fail();
  }catch{return fail();}
  if(value.canRevise!==undefined&&typeof value.canRevise!=='boolean')return fail();
  if(value.replacementTaskId!==undefined&&value.replacementTaskId!==null&&(!text(value.replacementTaskId,100)||!/^mail-[a-zA-Z0-9-]{1,80}$/.test(value.replacementTaskId)||value.replacementTaskId===taskId))return fail();
  if(value.canRevise===true&&(value.review===null||!object(value.source)||value.effects.length>0||value.replacementTaskId))return fail();
  if(object(value.draft)&&value.draft.reply!==undefined){try{validateEmailReply(value.draft.reply);}catch{return fail();}}
  if(value.draft!==undefined&&value.draft!==null){const p=value.draft;if(!object(p)||!text(p.from,254)||!text(p.subject,500)||!text(p.body,8000)||!text(p.contactId,500)||!['to','cc','bcc'].every(k=>Array.isArray(p[k])&&(p[k] as unknown[]).length<=10&&(p[k] as unknown[]).every(a=>text(a,254))))return fail();}
  if (value.review !== null) {
    const r = value.review;
    if (
      !object(r) ||
      r.taskId !== taskId ||
      !text(r.id) ||
      !text(r.owner) ||
      !hash(r.planHash) ||
      !hash(r.bindingHash) ||
      !hash(r.payloadHash) ||
      !Number.isSafeInteger(r.planVersion) ||
      (r.planVersion as number) < 1 ||
      !Number.isFinite(r.at) ||
      !object(r.payload)
    )
      return fail();
    const p = r.payload;
    if(p.reply!==undefined){try{validateEmailReply(p.reply);}catch{return fail();}}
    if (
      !text(p.from, 254) ||
      !text(p.subject, 500) ||
      !text(p.body, 8000) ||
      !text(p.contactId, 500) ||
      !["to", "cc", "bcc"].every(
        (k) =>
          Array.isArray(p[k]) &&
          (p[k] as unknown[]).length <= 10 &&
          (p[k] as unknown[]).every((a) => text(a, 254)),
      )
    )
      return fail();
  }
  if (value.decision !== undefined && value.decision !== null) {
    const d = value.decision;
    if (
      !object(d) ||
      !text(d.id) ||
      !text(d.userId) ||
      !hash(d.bindingHash) ||
      !["approved", "rejected"].includes(String(d.decision)) ||
      !Number.isFinite(d.at) ||
      !object(value.review) ||
      d.reviewId !== value.review.id ||
      d.bindingHash !== value.review.bindingHash ||
      d.userId !== value.review.owner
    )
      return fail();
  }
  if (value.policy !== undefined && value.policy !== null) {
    const p = value.policy;
    if (
      !object(p) ||
      !object(value.review) ||
      p.reviewId !== value.review.id ||
      !text(p.composition, 100) ||
      !text(p.flow, 100) ||
      !Number.isFinite(p.at)
    )
      return fail();
  }
  for (const e of value.effects) {
    if (
      !object(e) ||
      !text(e.id) ||
      !text(e.status, 100) ||
      !text(e.effective, 100) ||
      !Array.isArray(e.reconciliations) ||
      !Array.isArray(e.observationIds) ||
      !e.observationIds.every((id) => text(id))
    )
      return fail();
    for (const r of e.reconciliations)
      if (
        !object(r) ||
        !text(r.id) ||
        !text(r.outcome, 100) ||
        !Array.isArray(r.observationIds) ||
        !r.observationIds.every((id) => text(id))
      )
        return fail();
  }
  for (const a of value.audit)
    if (
      !object(a) ||
      a.taskId !== taskId ||
      !text(a.id) ||
      !text(a.type, 100) ||
      !text(a.reference) ||
      !Number.isFinite(a.at)
    )
      return fail();
  return structuredClone(value) as unknown as EmailWorkflowView;
}
