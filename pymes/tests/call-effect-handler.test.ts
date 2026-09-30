import assert from "node:assert/strict";
import test from "node:test";
import { callEffectHandler } from "../src/provider-effect-handlers.js";
import type { PendingEffect } from "../src/effects.js";

const effect: PendingEffect = { id: "call-1", tenantId: "agency-1", caseId: "case-1", kind: "call", payload: { objective: "Revisar póliza", questions: ["¿Qué cobertura necesita?"], contactId: "contact-1" }, status: "confirmed", requestedBy: "owner-1", requestedAt: "2026-09-30T08:00:00Z", retryCount: 0, confirmedBy: "reviewer-1", draftHash: "hash" };

test("call handler delegates a validated call plan", async () => {
  const note = await callEffectHandler({ start: async call => { assert.equal(call.objective, "Revisar póliza"); assert.deepEqual(call.questions, ["¿Qué cobertura necesita?"]); return { externalId: "call-1" }; } }).execute(effect, { tenantId: "agency-1", requestedBy: "owner-1", confirmedBy: "reviewer-1" });
  assert.equal(note, "Call started: call-1");
});

test("call handler rejects an empty call request", async () => {
  await assert.rejects(() => callEffectHandler({ start: async () => ({ externalId: "call-1" }) }).execute({ ...effect, payload: {} }, { tenantId: "agency-1", requestedBy: "owner-1", confirmedBy: "reviewer-1" }), /INVALID_CALL_EFFECT_PAYLOAD/);
});
