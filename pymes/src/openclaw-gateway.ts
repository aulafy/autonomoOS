import type { Channel, IncomingMessage } from "./domain.js";

/** Minimal boundary for an OpenClaw gateway event. The gateway is a transport,
 * not an authority to classify, identify, quote, or send on behalf of PYMES. */
export interface OpenClawInboundEvent {
  eventId: string;
  externalMessageId: string;
  channel: "whatsapp" | "telegram" | "imessage" | "email";
  conversationId: string;
  senderId: string;
  receivedAt: string;
  text: string;
  senderPaired: boolean;
  consented: boolean;
}

export interface OpenClawIngressPolicy {
  allowedChannels: ReadonlySet<Channel>;
  pairedSenderIds: ReadonlySet<string>;
  consentedConversationIds: ReadonlySet<string>;
}

export type OpenClawIngressResult =
  | { accepted: true; message: IncomingMessage }
  | { accepted: false; reason: "CHANNEL_NOT_ALLOWED" | "SENDER_NOT_PAIRED" |
      "CONSENT_NOT_RECORDED" | "INVALID_EVENT" };

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value)) && /T/.test(value);
}

/**
 * Converts one gateway event into our neutral inbox model. It deliberately
 * leaves identity and topic unresolved. No model, CRM lookup, or side effect
 * is performed here.
 */
export function ingestOpenClawEvent(event: OpenClawInboundEvent,
  policy: OpenClawIngressPolicy): OpenClawIngressResult {
  if (!nonempty(event.eventId) || !nonempty(event.externalMessageId) ||
    !nonempty(event.conversationId) || !nonempty(event.senderId) ||
    !nonempty(event.text) || !validTimestamp(event.receivedAt)) {
    return { accepted: false, reason: "INVALID_EVENT" };
  }
  if (!policy.allowedChannels.has(event.channel)) {
    return { accepted: false, reason: "CHANNEL_NOT_ALLOWED" };
  }
  if (!event.senderPaired || !policy.pairedSenderIds.has(event.senderId)) {
    return { accepted: false, reason: "SENDER_NOT_PAIRED" };
  }
  if (!event.consented || !policy.consentedConversationIds.has(event.conversationId)) {
    return { accepted: false, reason: "CONSENT_NOT_RECORDED" };
  }
  return { accepted: true, message: {
    id: `openclaw:${event.eventId}`,
    externalId: event.externalMessageId,
    channel: event.channel,
    receivedAt: event.receivedAt,
    text: event.text.trim(),
    topic: "unknown",
    classificationSource: "connector"
  } };
}
