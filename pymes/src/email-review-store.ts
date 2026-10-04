import {
  emailHash,
  validateEmailPayload,
  type EmailPayload,
} from "./email-provider.js";
export interface EmailReview {
  provider?: "gmail-email";
  id: string;
  taskId: string;
  owner: string;
  planVersion: number;
  planHash: string;
  stepId: string;
  payload: EmailPayload;
  payloadHash: string;
  bindingHash: string;
  at: number;
}
export interface EmailDecision {
  id: string;
  reviewId: string;
  bindingHash: string;
  userId: string;
  at: number;
  decision: "approved" | "rejected";
}
export interface EmailArtifact {
  id: string;
  taskId: string;
  attemptId: string | null;
  simulated: boolean;
  value: Record<string, unknown>;
  hash: string;
  at: number;
}
export interface EmailPolicy {
  reviewId: string;
  composition: string;
  flow: string;
  at: number;
}
export interface EmailAudit {
  id: string;
  taskId: string;
  type: string;
  at: number;
  reference: string;
}
export interface EmailQueueRecord {
 taskId:string;review:Pick<EmailReview,'id'|'owner'|'provider'|'at'|'bindingHash'|'payloadHash'|'planVersion'>|null;
 decision:EmailDecision|null;policy:EmailPolicy|null;draftAt:number|null;draftHash:string|null;
}
/** Append-only journal projection; inputs to this store come only from trusted host services. */
export class EmailReviewStore {
  private drafts: Array<{taskId:string;owner:string;payload:EmailPayload;at:number}>=[];
  private artifacts: EmailArtifact[] = [];
  private policies: EmailPolicy[] = [];
  private reviews: EmailReview[] = [];
  private decisions: EmailDecision[] = [];
  private audits: EmailAudit[] = [];
  propose(
    input: Omit<EmailReview, "payloadHash" | "bindingHash">,
  ): EmailReview {
    const payload = validateEmailPayload(input.payload),
      payloadHash = emailHash(payload);
    const bindingHash = emailHash({
      taskId: input.taskId,
      owner: input.owner,
      planVersion: input.planVersion,
      planHash: input.planHash,
      stepId: input.stepId,
      payloadHash,
      ...(input.provider?{provider:input.provider}:{}),
    });
    if (
      !input.id ||
      !input.taskId ||
      !input.owner ||
      !input.stepId ||
      !Number.isSafeInteger(input.planVersion) ||
      input.planVersion < 1 ||
      !/^[a-f0-9]{64}$/.test(input.planHash) ||
      !Number.isFinite(input.at)
    )
      throw new Error("INVALID_EMAIL_REVIEW");
    const record = { ...input, payload, payloadHash, bindingHash };
    const previous = this.reviews.find((r) => r.id === input.id);
    if (previous) {
      if (emailHash(previous) !== emailHash(record))
        throw new Error("EMAIL_REVIEW_ID_CONFLICT");
      return structuredClone(previous);
    }
    this.reviews.push(structuredClone(record));
    return structuredClone(record);
  }
  saveDraft(input:{taskId:string;owner:string;payload:EmailPayload;at:number}){if(!input.taskId||!input.owner||!Number.isFinite(input.at)||this.latest(input.taskId))throw new Error('EMAIL_DRAFT_LOCKED');const draft={...input,payload:validateEmailPayload(input.payload)};this.drafts=this.drafts.filter(d=>d.taskId!==input.taskId);this.drafts.push(structuredClone(draft));return structuredClone(draft);}
  draft(taskId:string){return structuredClone(this.drafts.find(d=>d.taskId===taskId)??null);}
  listReviews(): EmailReview[] {
    return structuredClone(this.reviews);
  }
  /** Metadata only: the queue must never export an email body or draft. */
  queueSnapshot(owner:string):EmailQueueRecord[]{
    const latest=new Map<string,EmailReview>();for(const r of this.reviews)if(r.owner===owner)latest.set(r.taskId,r);
    const decisions=new Map(this.decisions.map(d=>[d.reviewId,d])),policies=new Map(this.policies.map(p=>[p.reviewId,p])),drafts=new Map(this.drafts.filter(d=>d.owner===owner).map(d=>[d.taskId,d]));
    return [...new Set([...latest.keys(),...drafts.keys()])].map(taskId=>{
      const r=latest.get(taskId),d=drafts.get(taskId);
      return {taskId,review:r?{id:r.id,owner:r.owner,...(r.provider?{provider:r.provider}:{}),at:r.at,planVersion:r.planVersion,bindingHash:r.bindingHash,payloadHash:r.payloadHash}:null,decision:r?structuredClone(decisions.get(r.id)??null):null,policy:r?structuredClone(policies.get(r.id)??null):null,draftAt:d?.at??null,draftHash:d?emailHash(d.payload):null};
    });
  }
  recordArtifact(input: EmailArtifact): EmailArtifact {
    if (
      !input.id ||
      !input.taskId ||
      typeof input.simulated !== "boolean" ||
      emailHash(input.value) !== input.hash ||
      !Number.isFinite(input.at)
    )
      throw new Error("INVALID_EMAIL_ARTIFACT");
    const existing = this.artifacts.find((a) => a.id === input.id);
    if (existing) {
      if (emailHash(existing) !== emailHash(input))
        throw new Error("EMAIL_ARTIFACT_CONFLICT");
      return structuredClone(existing);
    }
    this.artifacts.push(structuredClone(input));
    return structuredClone(input);
  }
  artifactsFor(taskId: string): EmailArtifact[] {
    return structuredClone(this.artifacts.filter((a) => a.taskId === taskId));
  }
  recordPolicy(input: EmailPolicy): EmailPolicy {
    if (
      !this.reviews.some((r) => r.id === input.reviewId) ||
      !input.composition ||
      !input.flow ||
      !Number.isFinite(input.at)
    )
      throw new Error("INVALID_EMAIL_POLICY");
    this.policies.push(structuredClone(input));
    return structuredClone(input);
  }
  policy(reviewId: string): EmailPolicy | null {
    return structuredClone(
      this.policies.filter((p) => p.reviewId === reviewId).at(-1) ?? null,
    );
  }
  decide(input: EmailDecision): EmailDecision {
    const review = this.reviews.find((r) => r.id === input.reviewId);
    if (
      !input.id ||
      this.decisions.some(
        (d) => d.id === input.id && d.reviewId !== input.reviewId,
      ) ||
      !review ||
      review.bindingHash !== input.bindingHash ||
      review.owner !== input.userId ||
      !["approved", "rejected"].includes(input.decision) ||
      !Number.isFinite(input.at) ||
      input.at < review.at
    )
      throw new Error("EMAIL_APPROVAL_BINDING_DENIED");
    const existing = this.decisions.find((d) => d.reviewId === input.reviewId);
    if (existing) {
      if (
        existing.decision !== input.decision ||
        existing.bindingHash !== input.bindingHash ||
        existing.userId !== input.userId
      )
        throw new Error("EMAIL_DECISION_CONFLICT");
      return structuredClone(existing);
    }
    if (this.latest(review.taskId)?.id !== review.id)
      throw new Error("EMAIL_REVIEW_SUPERSEDED");
    this.decisions.push(structuredClone(input));
    return structuredClone(input);
  }
  audit(input: EmailAudit): EmailAudit {
    if (
      !input.id ||
      !input.taskId ||
      !input.type ||
      !input.reference ||
      !Number.isFinite(input.at)
    )
      throw new Error("INVALID_EMAIL_AUDIT");
    const previous = this.audits.find((a) => a.id === input.id);
    if (previous) {
      if (emailHash(previous) !== emailHash(input))
        throw new Error("EMAIL_AUDIT_CONFLICT");
      return structuredClone(previous);
    }
    this.audits.push(structuredClone(input));
    return structuredClone(input);
  }
  latest(taskId: string): EmailReview | null {
    return structuredClone(
      this.reviews.filter((r) => r.taskId === taskId).at(-1) ?? null,
    );
  }
  decision(reviewId: string): EmailDecision | null {
    return structuredClone(
      this.decisions.find((d) => d.reviewId === reviewId) ?? null,
    );
  }
  timeline(taskId: string): EmailAudit[] {
    return structuredClone(this.audits.filter((a) => a.taskId === taskId));
  }
}
