import type { Channel, IncomingMessage } from "./domain.js";

/** Minimal boundary for an OpenClaw gateway event. The gateway is a transport,
 * not an authority to classify, identify, quote, or send on behalf of PYMES. */
export interface OpenClawInboundEvent {
  eventId: string;
  externalMessageId: string;
  channel: Channel;
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
  maxEventAgeMs?: number;
  maxFutureSkewMs?: number;
}

export interface OpenClawEnterpriseEnvelope {
  tenantId: string;
  agentId: string;
  resourceId: string;
  inbound: OpenClawInboundEvent;
}

export interface OpenClawEnterprisePolicy extends OpenClawIngressPolicy {
  tenantId: string;
  allowedAgentIds: ReadonlySet<string>;
  allowedResourceIds: ReadonlySet<string>;
}

export type OpenClawIngressResult =
  | { accepted: true; message: IncomingMessage }
  | { accepted: false; reason: "CHANNEL_NOT_ALLOWED" | "SENDER_NOT_PAIRED" |
      "CONSENT_NOT_RECORDED" | "INVALID_EVENT" };

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeText(value: unknown, maxLength: number): value is string {
  return nonempty(value) && value.length <= maxLength && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}
function safeMetadata(value: unknown, maxLength: number): value is string {
  return nonempty(value) && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}

function validTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value)) && /T/.test(value);
}
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;

/**
 * Converts one gateway event into our neutral inbox model. It deliberately
 * leaves identity and topic unresolved. No model, CRM lookup, or side effect
 * is performed here.
 */
export function ingestOpenClawEvent(event: OpenClawInboundEvent,
  policy: OpenClawIngressPolicy): OpenClawIngressResult {
  const maxAge = policy.maxEventAgeMs ?? MAX_EVENT_AGE_MS;
  const maxFuture = policy.maxFutureSkewMs ?? MAX_FUTURE_SKEW_MS;
  if (!Number.isFinite(maxAge) || maxAge < 0 || maxAge > 30 * 24 * 60 * 60 * 1000 ||
    !Number.isFinite(maxFuture) || maxFuture < 0 || maxFuture > 24 * 60 * 60 * 1000) {
    return { accepted: false, reason: "INVALID_EVENT" };
  }
  if (!safeMetadata(event.eventId, 200) || !safeMetadata(event.externalMessageId, 200) ||
    !safeMetadata(event.conversationId, 200) || !safeMetadata(event.senderId, 200) ||
    !safeText(event.text, 10_000) || !safeText(event.receivedAt, 100) || !validTimestamp(event.receivedAt) ||
    Date.now() - Date.parse(event.receivedAt) > maxAge || Date.parse(event.receivedAt) - Date.now() > maxFuture) {
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

/** Checks enterprise scope before the ordinary channel boundary. */
export function ingestOpenClawEnterpriseEvent(
  envelope: OpenClawEnterpriseEnvelope,
  policy: OpenClawEnterprisePolicy
): OpenClawIngressResult {
  if (!safeMetadata(envelope.tenantId, 200) || !safeMetadata(envelope.agentId, 200) ||
    !safeMetadata(envelope.resourceId, 200)) return { accepted: false, reason: "INVALID_EVENT" };
  if (envelope.tenantId !== policy.tenantId ||
    !policy.allowedAgentIds.has(envelope.agentId) ||
    !policy.allowedResourceIds.has(envelope.resourceId)) {
    return { accepted: false, reason: "INVALID_EVENT" };
  }
  return ingestOpenClawEvent(envelope.inbound, policy);
}
