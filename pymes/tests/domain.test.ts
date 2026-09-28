import assert from "node:assert/strict";
import test from "node:test";
import { buildMorningBrief } from "../src/domain.js";
import { makeDemoData } from "../src/fixtures.js";

const now = new Date("2026-09-28T08:00:00.000Z");

test("morning brief deduplicates source events and prioritizes incidents", () => {
  const brief = buildMorningBrief(makeDemoData(now));
  assert.equal(brief.counts.total, 8);
  assert.equal(brief.counts.byChannel.whatsapp, 3);
  assert.equal(brief.counts.byChannel.telegram, 1);
  assert.equal(brief.counts.byChannel.imessage, 1);
  assert.equal(brief.counts.byChannel.email, 3);
  assert.equal(brief.items[0]?.message.topic, "incident");
  assert.equal(brief.items[0]?.priority, "urgent");
  assert.equal(brief.items.some(item => item.id === "msg-1-duplicate"), false);
  assert.equal(brief.items.filter(item => item.priority === "high").length, 3);
  assert.equal(brief.counts.unidentified, 1);
});

test("all suggestions remain drafts and quote intake never invents a premium", () => {
  const brief = buildMorningBrief(makeDemoData(now));
  assert.ok(brief.items.every(item => item.reviewRequired &&
    item.executionStatus === "draft_only"));
  const quotes = brief.items.filter(item => item.message.topic === "quote");
  assert.equal(quotes.length, 4);
  assert.deepEqual(new Set(quotes.map(item => item.message.insuranceLine)),
    new Set(["auto", "home", "life", "selfEmployedLiability"]));
  assert.ok(quotes.every(item => item.missingInformation.length >= 3));
  assert.ok(quotes.find(item => item.message.insuranceLine === "life")?.missingInformation
    .some(value => value.includes("canal autorizado")));
  assert.ok(quotes.every(item => !/\b\d+[,.]?\d*\s?€/.test(item.draft)));
  assert.ok(brief.appointments.every(appointment =>
    appointment.state === "confirmed" || appointment.state === "proposed"));
});

test("unknown contacts remain visible but cannot receive a personalized draft", () => {
  const data = makeDemoData(now);
  data.messages[0]!.contactId = "not-in-crm";
  const brief = buildMorningBrief(data);
  assert.equal(brief.counts.unidentified, 2);
  const incident = brief.items.find(item => item.id === "msg-1");
  assert.equal(incident?.contact, null);
  assert.equal(incident?.identityStatus, "unidentified");
  assert.equal(incident?.priority, "urgent");
  assert.match(incident?.draft ?? "", /No enviar/);
  assert.ok(incident?.missingInformation.includes("Identidad y vínculo con expediente"));
});
