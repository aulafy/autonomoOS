import assert from "node:assert/strict";
import test from "node:test";
import { buildCallPlan } from "../src/call-plan.js";
import { buildMorningBrief } from "../src/domain.js";
import { makeDemoData } from "../src/fixtures.js";

const brief = buildMorningBrief(makeDemoData(new Date("2026-09-28T07:00:00Z")));

test("known local contact call plan includes upcoming appointment", () => {
  const diego = brief.items.find(item => item.contact?.id === "contact-diego")!;
  const plan = buildCallPlan(diego, brief);
  assert.equal(plan.status, "ready_for_review");
  assert.equal(plan.nextAppointment?.title, "Llamada sobre seguro de hogar");
  assert.ok(plan.questions.includes("Vivienda y uso"));
});

test("unidentified contact call plan cannot inherit another person's appointment", () => {
  const unknown = brief.items.find(item => item.identityStatus === "unidentified")!;
  const plan = buildCallPlan(unknown, brief);
  assert.equal(plan.status, "identity_required");
  assert.equal(plan.nextAppointment, null);
  assert.match(plan.objective, /Verificar/);
  assert.ok(plan.questions.some(question => question.includes("identidad")));
});
