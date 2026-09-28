import assert from "node:assert/strict";
import test from "node:test";
import { buildMorningBrief } from "../src/domain.js";
import { makeDemoData } from "../src/fixtures.js";

const now = new Date("2026-09-28T08:00:00.000Z");

test("morning brief deduplicates source events and prioritizes incidents", () => {
  const brief = buildMorningBrief(makeDemoData(now));
  assert.equal(brief.counts.total, 6);
  assert.equal(brief.counts.byChannel.whatsapp, 2);
  assert.equal(brief.counts.byChannel.telegram, 1);
  assert.equal(brief.counts.byChannel.imessage, 1);
  assert.equal(brief.counts.byChannel.email, 2);
  assert.equal(brief.items[0]?.message.topic, "incident");
  assert.equal(brief.items[0]?.priority, "urgent");
  assert.equal(brief.items.some(item => item.id === "msg-1-duplicate"), false);
  assert.equal(brief.items.filter(item => item.priority === "high").length, 2);
});

test("all suggestions remain drafts and quote intake never invents a premium", () => {
  const brief = buildMorningBrief(makeDemoData(now));
  assert.ok(brief.items.every(item => item.reviewRequired &&
    item.executionStatus === "draft_only"));
  const quotes = brief.items.filter(item => item.message.topic === "quote");
  assert.equal(quotes.length, 2);
  assert.ok(quotes.every(item => item.missingInformation.includes("Datos del riesgo")));
  assert.ok(quotes.every(item => !/\b\d+[,.]?\d*\s?€/.test(item.draft)));
  assert.ok(brief.appointments.every(appointment =>
    appointment.state === "confirmed" || appointment.state === "proposed"));
});

test("unknown contacts fail instead of silently assigning a message", () => {
  const data = makeDemoData(now);
  data.messages[0]!.contactId = "not-in-crm";
  assert.throws(() => buildMorningBrief(data), /UNKNOWN_CONTACT/);
});
