import assert from "node:assert/strict";
import test from "node:test";
import { googleCalendarEffectHandler } from "../src/provider-effect-handlers.js";
import type { PendingEffect } from "../src/effects.js";

const effect: PendingEffect = {
  id: "calendar-1", tenantId: "agency-1", caseId: "case-1", kind: "calendar",
  payload: { title: "Revisión", startsAt: "2026-09-30T10:00:00Z", endsAt: "2026-09-30T10:30:00Z" }, status: "confirmed",
  requestedBy: "owner-1", requestedAt: "2026-09-30T08:00:00Z", retryCount: 0, confirmedBy: "reviewer-1", draftHash: "hash",
};

test("calendar provider handler translates a confirmed effect to Google API", async () => {
  const note = await googleCalendarEffectHandler({ accessToken: "token", calendarId: "primary", fetcher: async () => new Response(JSON.stringify({ id: "google-1", summary: "Revisión", start: { dateTime: effect.payload.startsAt }, end: { dateTime: effect.payload.endsAt } }), { status: 200 }) }).execute(effect, { tenantId: "agency-1", requestedBy: "owner-1", confirmedBy: "reviewer-1" });
  assert.equal(note, "Google Calendar event created: google-1");
});

test("calendar provider handler requires an end time", async () => {
  await assert.rejects(() => googleCalendarEffectHandler({ accessToken: "token", calendarId: "primary" }).execute({ ...effect, payload: { title: "Revisión", startsAt: effect.payload.startsAt } }, { tenantId: "agency-1", requestedBy: "owner-1", confirmedBy: "reviewer-1" }), /INVALID_CALENDAR_EFFECT_PAYLOAD/);
});
