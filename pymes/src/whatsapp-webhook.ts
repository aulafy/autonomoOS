import { createHmac, timingSafeEqual } from "node:crypto";
import type { OpenClawEnterpriseEnvelope } from "./openclaw-gateway.js";

export interface WhatsAppInboundMessage {
  externalMessageId: string;
  senderId: string;
  phoneNumberId: string;
  text: string;
  receivedAt: string;
}

/** Maps verified Meta messages to neutral OpenClaw envelopes. */
export function toOpenClawWhatsAppEnvelopes(input: {
  messages: readonly WhatsAppInboundMessage[];
  tenantId: string;
  agentId: string;
  resourceId: string;
  pairedSenderIds?: ReadonlySet<string>;
  consentedConversationIds?: ReadonlySet<string>;
}): OpenClawEnterpriseEnvelope[] {
  if (!input.tenantId.trim() || !input.agentId.trim() || !input.resourceId.trim()) throw new Error("INVALID_OPENCLAW_SCOPE");
  return input.messages.slice(0, 100).map(message => ({
    tenantId: input.tenantId, agentId: input.agentId, resourceId: input.resourceId,
    inbound: {
      eventId: `whatsapp:${message.externalMessageId}`,
      externalMessageId: message.externalMessageId,
      channel: "whatsapp",
      conversationId: `whatsapp:${message.senderId}`,
      senderId: message.senderId,
      receivedAt: message.receivedAt,
      text: message.text,
      senderPaired: input.pairedSenderIds?.has(message.senderId) ?? false,
      consented: input.consentedConversationIds?.has(`whatsapp:${message.senderId}`) ?? false,
    }
  }));
}

/** Meta webhook challenge used during app configuration. */
export function verifyWhatsAppWebhookChallenge(input: {
  mode?: string; verifyToken?: string; challenge?: string; configuredToken: string;
}): string {
  if (input.mode !== "subscribe" || !input.verifyToken || !input.challenge || !input.configuredToken || input.verifyToken !== input.configuredToken) {
    throw new Error("WHATSAPP_WEBHOOK_VERIFICATION_FAILED");
  }
  if (input.challenge.length > 512 || /[\u0000-\u001f\u007f]/.test(input.challenge)) throw new Error("INVALID_WHATSAPP_CHALLENGE");
  return input.challenge;
}

/** Validates Meta's HMAC header without accepting malformed signatures. */
export function verifyWhatsAppSignature(input: { rawBody: string; signature?: string; appSecret: string }): boolean {
  if (!input.appSecret || !input.signature?.startsWith("sha256=")) return false;
  const received = input.signature.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  const expected = createHmac("sha256", input.appSecret).update(input.rawBody, "utf8").digest("hex");
  return timingSafeEqual(Buffer.from(received.toLowerCase(), "hex"), Buffer.from(expected, "hex"));
}

/** Extracts only bounded text messages from a Meta webhook envelope. */
export function parseWhatsAppInboundPayload(payload: unknown, now = new Date()): WhatsAppInboundMessage[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("INVALID_WHATSAPP_PAYLOAD");
  const body = payload as Record<string, unknown>;
  if (body.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) throw new Error("INVALID_WHATSAPP_PAYLOAD");
  const result: WhatsAppInboundMessage[] = [];
  for (const entryValue of body.entry.slice(0, 50)) {
    const entry = entryValue && typeof entryValue === "object" && !Array.isArray(entryValue) ? entryValue as Record<string, unknown> : null;
    const changes = entry && Array.isArray(entry.changes) ? entry.changes : [];
    for (const changeValue of changes.slice(0, 50)) {
      const change = changeValue && typeof changeValue === "object" && !Array.isArray(changeValue) ? changeValue as Record<string, unknown> : null;
      const value = change?.value && typeof change.value === "object" && !Array.isArray(change.value) ? change.value as Record<string, unknown> : null;
      const metadata = value?.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata) ? value.metadata as Record<string, unknown> : null;
      const phoneNumberId = typeof metadata?.phone_number_id === "string" ? metadata.phone_number_id : "";
      const messages = value && Array.isArray(value.messages) ? value.messages : [];
      for (const messageValue of messages.slice(0, 100)) {
        const message = messageValue && typeof messageValue === "object" && !Array.isArray(messageValue) ? messageValue as Record<string, unknown> : null;
        const textBody = message?.text && typeof message.text === "object" && !Array.isArray(message.text) ? (message.text as Record<string, unknown>).body : undefined;
        const id = typeof message?.id === "string" ? message.id : "";
        const senderId = typeof message?.from === "string" ? message.from : "";
        if (message?.type !== "text" || !phoneNumberId || !id || !senderId || typeof textBody !== "string" || !textBody.trim() || textBody.length > 4_000) continue;
        result.push({ externalMessageId: id.slice(0, 200), senderId: senderId.slice(0, 100), phoneNumberId: phoneNumberId.slice(0, 100), text: textBody, receivedAt: now.toISOString() });
      }
    }
  }
  return result.slice(0, 100);
}
