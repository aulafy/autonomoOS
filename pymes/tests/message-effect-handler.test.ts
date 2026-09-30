import assert from "node:assert/strict";
import test from "node:test";
import { messageEffectHandler } from "../src/provider-effect-handlers.js";
import type { PendingEffect } from "../src/effects.js";

const effect: PendingEffect = { id: "message-1", tenantId: "agency-1", caseId: "case-1", kind: "message", payload: { channel: "whatsapp", text: "Hola", contactId: "contact-1" }, status: "confirmed", requestedBy: "owner-1", requestedAt: "2026-09-30T08:00:00Z", retryCount: 0, confirmedBy: "reviewer-1", draftHash: "hash" };

test("message handler delegates a confirmed message and returns provider id", async () => {
  let channel = "";
  const note = await messageEffectHandler({ send: async input => { channel = input.channel; assert.equal(input.text, "Hola"); assert.equal(input.idempotencyKey, "message-1"); return { externalId: "wamid-1" }; } }).execute(effect, { tenantId: "agency-1", requestedBy: "owner-1", confirmedBy: "reviewer-1", idempotencyKey: "message-1" });
  assert.equal(channel, "whatsapp"); assert.equal(note, "Message sent via whatsapp: wamid-1");
});

test("message handler rejects unsafe provider responses", async () => {
  await assert.rejects(() => messageEffectHandler({ send: async () => ({ externalId: "" }) }).execute(effect, { tenantId: "agency-1", requestedBy: "owner-1", confirmedBy: "reviewer-1" }), /INVALID_MESSAGE_PROVIDER_RESPONSE/);
});
