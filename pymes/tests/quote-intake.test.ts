import assert from "node:assert/strict";
import test from "node:test";
import { evaluateQuoteIntake, quoteRequirements } from "../src/quote-intake.js";
import type { InsuranceLine } from "../src/config.js";

for (const line of Object.keys(quoteRequirements) as InsuranceLine[]) {
  test(`ficha de ${line}: solo los datos preliminares se pueden marcar`, () => {
    const local = quoteRequirements[line].filter(requirement => !requirement.externalOnly);
    const result = evaluateQuoteIntake({ line, identityStatus: "linked",
      checkedIds: new Set(local.map(requirement => requirement.id)) });
    assert.equal(result.checked, local.length);
    assert.equal(result.total, local.length);
    assert.equal(result.status, line === "life" ? "external_step_required" : "preliminary_complete");
    assert.equal(JSON.stringify(result).includes("prima"), false);
  });
}

test("sin identidad vinculada la preparación queda bloqueada", () => {
  const result = evaluateQuoteIntake({ line: "auto", identityStatus: "unidentified",
    checkedIds: new Set() });
  assert.equal(result.status, "identity_required");
});

test("el cuestionario externo de vida no puede marcarse en la ficha", () => {
  assert.throws(() => evaluateQuoteIntake({ line: "life", identityStatus: "linked",
    checkedIds: new Set(["insurerQuestionnaire"]) }), /INVALID_QUOTE_CHECK/);
});

test("sin ramo no se presume una ficha", () => {
  const result = evaluateQuoteIntake({ identityStatus: "linked", checkedIds: new Set() });
  assert.equal(result.status, "line_required");
  assert.equal(result.total, 0);
});
