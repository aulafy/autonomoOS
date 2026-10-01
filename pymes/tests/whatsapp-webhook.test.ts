import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { parseWhatsAppInboundPayload, verifyWhatsAppSignature, verifyWhatsAppWebhookChallenge } from "../src/whatsapp-webhook.js";

test("Meta webhook challenge requires the configured token", () => {
  assert.equal(verifyWhatsAppWebhookChallenge({ mode: "subscribe", verifyToken: "secret", challenge: "abc", configuredToken: "secret" }), "abc");
  assert.throws(() => verifyWhatsAppWebhookChallenge({ mode: "subscribe", verifyToken: "bad", challenge: "abc", configuredToken: "secret" }), /VERIFICATION_FAILED/);
});

test("Meta webhook signature is checked with HMAC", () => {
  const rawBody = '{"object":"whatsapp_business_account"}';
  const digest = createHmac("sha256", "app-secret").update(rawBody).digest("hex");
  assert.equal(verifyWhatsAppSignature({ rawBody, appSecret: "app-secret", signature: `sha256=${digest}` }), true);
  assert.equal(verifyWhatsAppSignature({ rawBody, appSecret: "app-secret", signature: "sha256=bad" }), false);
});

test("Meta payload extracts bounded text messages", () => {
  const messages = parseWhatsAppInboundPayload({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "12345678" }, messages: [{ id: "wamid-1", from: "34600111222", type: "text", text: { body: "Necesito un seguro de coche" } }] } }] }] }, new Date("2026-10-01T08:00:00.000Z"));
  assert.deepEqual(messages, [{ externalMessageId: "wamid-1", senderId: "34600111222", phoneNumberId: "12345678", text: "Necesito un seguro de coche", receivedAt: "2026-10-01T08:00:00.000Z" }]);
});
