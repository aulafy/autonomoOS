import { insuranceLines, type InsuranceLine } from "./config.js";
import type { IncomingMessage, Topic } from "./domain.js";

export interface ClassificationProposal {
  topic: Topic;
  insuranceLine: InsuranceLine | null;
}

const topics: readonly Topic[] = ["incident", "quote", "renewal", "appointment", "service", "unknown"];

/** Strict boundary for a future untrusted model response. A proposal has no effect. */
export function parseClassificationProposal(value: unknown): ClassificationProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_CLASSIFICATION_PROPOSAL");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== "topic" && key !== "insuranceLine") ||
    !topics.includes(record.topic as Topic) ||
    (record.insuranceLine !== null &&
      (typeof record.insuranceLine !== "string" ||
        !Object.hasOwn(insuranceLines, record.insuranceLine)))) {
    throw new Error("INVALID_CLASSIFICATION_PROPOSAL");
  }
  return { topic: record.topic as Topic,
    insuranceLine: record.insuranceLine as InsuranceLine | null };
}

/** Explicit operator acceptance changes only local classification fields. */
export function acceptClassification(message: IncomingMessage,
  proposal: ClassificationProposal, reason: string,
  reviewedAt: string): IncomingMessage {
  const parsed = parseClassificationProposal(proposal);
  if (reason.trim().length < 5 || Number.isNaN(Date.parse(reviewedAt))) {
    throw new Error("CLASSIFICATION_REVIEW_REQUIRED");
  }
  return { ...message, topic: parsed.topic,
    insuranceLine: parsed.insuranceLine ?? undefined,
    classificationSource: "human",
    classificationReview: { reason: reason.trim(), reviewedAt } };
}
