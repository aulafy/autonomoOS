import assert from "node:assert/strict";
import test from "node:test";
import { acceptClassification, parseClassificationProposal } from "../src/classification.js";
import { makeDemoData } from "../src/fixtures.js";
import { buildMorningBrief } from "../src/domain.js";

test("model shaped classification stays inert until human acceptance", () => {
  const message = makeDemoData(new Date("2026-09-28T07:00:00Z")).messages[0]!;
  const proposal = parseClassificationProposal({ topic: "service", insuranceLine: "home" });
  assert.equal(message.topic, "incident");
  assert.equal(message.classificationSource, "demo_fixture");
  const accepted = acceptClassification(message, proposal,
    "Revisión de la solicitud original", "2026-09-28T08:00:00Z");
  assert.equal(accepted.topic, "service");
  assert.equal(accepted.insuranceLine, "home");
  assert.equal(accepted.classificationSource, "human");
  assert.equal(message.topic, "incident");
  assert.equal(accepted.externalId, message.externalId);
  assert.equal(accepted.reportedIncident, true);
  assert.equal(accepted.classificationReview?.reason, "Revisión de la solicitud original");
});

test("a correction requires a reason and cannot erase an incident signal", () => {
  const data = makeDemoData(new Date("2026-09-28T07:00:00Z"));
  const original = data.messages[0]!;
  const proposal = { topic: "quote" as const, insuranceLine: "home" as const };
  assert.throws(() => acceptClassification(original, proposal, "", "2026-09-28T08:00:00Z"),
    /CLASSIFICATION_REVIEW_REQUIRED/);
  data.messages[0] = acceptClassification(original, proposal,
    "Clasificación corregida tras lectura", "2026-09-28T08:00:00Z");
  assert.equal(data.messages[0]?.reportedIncident, true);
  assert.equal(buildMorningBrief(data).items.find(item => item.id === "msg-1")?.priority,
    "urgent");
});

test("unknown labels and extra fields never enter the morning brief", () => {
  for (const value of [
    { topic: "purchase", insuranceLine: "auto" },
    { topic: "quote", insuranceLine: "travel" },
    { topic: "quote", insuranceLine: null, sendNow: true },
    { topic: "quote" }, null, "quote"
  ]) assert.throws(() => parseClassificationProposal(value), /INVALID_CLASSIFICATION_PROPOSAL/);
});
