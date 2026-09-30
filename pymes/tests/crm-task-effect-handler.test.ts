import assert from "node:assert/strict";
import test from "node:test";
import { crmTaskEffectHandler } from "../src/provider-effect-handlers.js";
import type { PendingEffect } from "../src/effects.js";

const effect: PendingEffect = { id: "crm-1", tenantId: "agency-1", caseId: "case-1", kind: "crm_task", payload: { title: "Llamar", contactId: "contact-1", dueAt: "2026-10-01T09:00:00Z" }, status: "confirmed", requestedBy: "owner-1", requestedAt: "2026-09-30T08:00:00Z", retryCount: 0, confirmedBy: "reviewer-1", draftHash: "hash" };

test("CRM task handler delegates a validated task", async () => {
  const note = await crmTaskEffectHandler({ create: async task => { assert.equal(task.contactId, "contact-1"); assert.equal(task.title, "Llamar"); return { externalId: "task-1" }; } }).execute(effect, { tenantId: "agency-1", requestedBy: "owner-1", confirmedBy: "reviewer-1" });
  assert.equal(note, "CRM task created: task-1");
});

test("CRM task handler rejects invalid due dates", async () => {
  await assert.rejects(() => crmTaskEffectHandler({ create: async () => ({ externalId: "task-1" }) }).execute({ ...effect, payload: { title: "Llamar", contactId: "contact-1", dueAt: "mañana" } }, { tenantId: "agency-1", requestedBy: "owner-1", confirmedBy: "reviewer-1" }), /INVALID_CRM_TASK_EFFECT_PAYLOAD/);
});
