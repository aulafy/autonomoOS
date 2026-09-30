import assert from "node:assert/strict";
import test from "node:test";
import { dispatchConfirmedEffect } from "../src/effect-dispatcher.js";
import type { PendingEffect } from "../src/effects.js";

const effect: PendingEffect = {
  id: "effect-1", tenantId: "agency-1", caseId: "case-1", kind: "crm_task",
  payload: { title: "Llamar al cliente", contactId: "contact-1" }, status: "confirmed",
  requestedBy: "owner-1", requestedAt: "2026-09-30T08:00:00.000Z", retryCount: 0,
  confirmedBy: "reviewer-1", confirmedAt: "2026-09-30T08:01:00.000Z", draftHash: "hash-1",
};

test("dispatches only confirmed effects through the matching tenant handler", async () => {
  let receivedId = "";
  const note = await dispatchConfirmedEffect(effect, { crm_task: {
    async execute(input, context) { receivedId = input.id; assert.equal(context.requestId, "req-1"); return "CRM task created"; },
  } }, { tenantId: "agency-1", requestedBy: "owner-1", confirmedBy: "reviewer-1", requestId: "req-1" });
  assert.equal(receivedId, "effect-1");
  assert.equal(note, "CRM task created");
});

test("rejects unconfirmed, cross-tenant and unconfigured effects", async () => {
  await assert.rejects(() => dispatchConfirmedEffect({ ...effect, status: "pending" }, {}, { tenantId: "agency-1", requestedBy: "owner-1", confirmedBy: "reviewer-1" }), /EFFECT_NOT_CONFIRMED/);
  await assert.rejects(() => dispatchConfirmedEffect(effect, {}, { tenantId: "agency-2", requestedBy: "owner-1", confirmedBy: "reviewer-1" }), /EFFECT_TENANT_MISMATCH/);
  await assert.rejects(() => dispatchConfirmedEffect(effect, {}, { tenantId: "agency-1", requestedBy: "owner-1", confirmedBy: "reviewer-1" }), /EFFECT_HANDLER_NOT_CONFIGURED/);
});

test("rejects unsafe provider notes", async () => {
  await assert.rejects(() => dispatchConfirmedEffect(effect, { crm_task: { async execute() { return "bad\u0007note"; } } }, { tenantId: "agency-1", requestedBy: "owner-1", confirmedBy: "reviewer-1" }), /INVALID_EFFECT_EXECUTION_NOTE/);
});
