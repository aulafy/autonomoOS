import type { EmailWorkflowView } from "./email-workflow.js";
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
