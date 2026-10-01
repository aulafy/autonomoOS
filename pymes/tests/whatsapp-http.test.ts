import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { handleWhatsAppWebhook } from "../src/whatsapp-http.js";

test("WhatsApp HTTP handler verifies challenge and signed payload", async () => {
  const query = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "verify", "hub.challenge": "challenge" });
  const challenge = await handleWhatsAppWebhook({ request: new Request(`http://localhost/webhooks/whatsapp?${query}`), verifyToken: "verify", appSecret: "secret", tenantId: "t", agentId: "a", resourceId: "r", ingest: () => {} });
  assert.equal(challenge.status, 200); assert.equal(await challenge.text(), "challenge");
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
  const response = await handleWhatsAppWebhook({ request: new Request("http://localhost/webhooks/whatsapp", { method: "POST", body, headers: { "content-type": "application/json", "x-hub-signature-256": signature } }), verifyToken: "verify", appSecret: "secret", tenantId: "t", agentId: "a", resourceId: "r", ingest: () => {} });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { received: 0 });
});
