import assert from "node:assert/strict";
import test from "node:test";
import { ingestOpenClawEnterpriseEvent, ingestOpenClawEvent,
  type OpenClawInboundEvent } from "../src/openclaw-gateway.js";

const event: OpenClawInboundEvent = {
  eventId: "evt-1", externalMessageId: "wa-1", channel: "whatsapp",
  conversationId: "conversation-1", senderId: "sender-1",
  receivedAt: "2026-09-29T08:00:00+02:00", text: "Necesito revisar mi seguro",
  senderPaired: true, consented: true
};
const policy = {
  allowedChannels: new Set(["whatsapp", "telegram", "imessage", "email"] as const),
  pairedSenderIds: new Set(["sender-1"]),
  consentedConversationIds: new Set(["conversation-1"])
};

test("OpenClaw gateway event entra como mensaje sin identidad ni intención", () => {
  const result = ingestOpenClawEvent(event, policy);
  assert.equal(result.accepted, true);
  if (!result.accepted) return;
  assert.equal(result.message.topic, "unknown");
  assert.equal(result.message.contactId, undefined);
  assert.equal(result.message.classificationSource, "connector");
  assert.equal(result.message.id, "openclaw:evt-1");
});

test("mensaje de remitente no emparejado queda bloqueado en el borde", () => {
  const result = ingestOpenClawEvent({ ...event, senderId: "new-sender", senderPaired: false }, policy);
  assert.deepEqual(result, { accepted: false, reason: "SENDER_NOT_PAIRED" });
});

test("consentimiento y canal son controles independientes", () => {
  assert.deepEqual(ingestOpenClawEvent({ ...event, consented: false }, policy),
    { accepted: false, reason: "CONSENT_NOT_RECORDED" });
  assert.deepEqual(ingestOpenClawEvent({ ...event, channel: "email" }, {
    ...policy, allowedChannels: new Set(["telegram"] as const)
  }), { accepted: false, reason: "CHANNEL_NOT_ALLOWED" });
});

test("evento malformado no produce una tarea parcial", () => {
  const result = ingestOpenClawEvent({ ...event, text: "", receivedAt: "not-a-date" }, policy);
  assert.deepEqual(result, { accepted: false, reason: "INVALID_EVENT" });
});

test("evento OpenClaw rechaza texto y metadatos fuera de límites", () => {
  const oversized = ingestOpenClawEvent({ ...event, text: "x".repeat(10_001) }, policy);
  assert.deepEqual(oversized, { accepted: false, reason: "INVALID_EVENT" });
  const control = ingestOpenClawEvent({ ...event, senderId: "sender-1\u0001" }, policy);
  assert.deepEqual(control, { accepted: false, reason: "INVALID_EVENT" });
});

test("la envolvente Enterprise impone tenant, agente y recurso", () => {
  const enterprisePolicy = { ...policy, tenantId: "agency-1",
    allowedAgentIds: new Set(["agent-1"]), allowedResourceIds: new Set(["resource-inbox-1"]) };
  const accepted = ingestOpenClawEnterpriseEvent({ tenantId: "agency-1", agentId: "agent-1",
    resourceId: "resource-inbox-1", inbound: event }, enterprisePolicy);
  assert.equal(accepted.accepted, true);
  assert.deepEqual(ingestOpenClawEnterpriseEvent({ tenantId: "agency-2", agentId: "agent-1",
    resourceId: "resource-inbox-1", inbound: event }, enterprisePolicy),
    { accepted: false, reason: "INVALID_EVENT" });
});
