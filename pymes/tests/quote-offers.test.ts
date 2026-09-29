import assert from "node:assert/strict";
import test from "node:test";
import { offersForCase, parseEuroCents, recordQuoteOffer, type OfferEntry } from "../src/quote-offers.js";

const entry: OfferEntry = {
  insurer: "Aseguradora de prueba", insurerReference: "REF-2026-01",
  sourceDocument: "Oferta PDF recibida por canal autorizado",
  annualPremium: "149,50", validUntil: "2026-10-30",
  coverageSummary: "Según documento original", exclusionsSummary: "Según documento original"
};
const context = { id: "offer-1", caseId: "msg-2", line: "home" as const,
  intakeStatus: "preliminary_complete" as const, enteredAt: "2026-09-28T10:00:00Z" };

test("solo se registra una transcripción de oferta con procedencia", () => {
  const offer = recordQuoteOffer({ ...context, entry });
  assert.equal(offer.annualPremiumCents, 14950);
  assert.equal(offer.source, "operator_transcription");
  assert.equal(offer.insurerReference, entry.insurerReference);
  assert.deepEqual(offersForCase([offer], "msg-2", "home"), [offer]);
  assert.deepEqual(offersForCase([offer], "otro-caso", "home"), []);
});

test("no se registra oferta antes de completar datos e identidad", () => {
  for (const intakeStatus of ["collecting", "identity_required", "external_step_required"] as const) {
    assert.throws(() => recordQuoteOffer({ ...context, intakeStatus, entry }),
      /OFFER_INTAKE_INCOMPLETE/);
  }
});

test("prima, vigencia, fuente y referencia son obligatorias", () => {
  assert.throws(() => parseEuroCents("1.234"), /INVALID_OFFER_PREMIUM/);
  for (const annualPremium of ["", "0", "-12", "15.999", "abc", "1e3"]) {
    assert.throws(() => recordQuoteOffer({ ...context, entry: { ...entry, annualPremium } }),
      /INVALID_OFFER_PREMIUM/);
  }
  assert.throws(() => recordQuoteOffer({ ...context, entry: { ...entry, sourceDocument: " " } }),
    /INVALID_OFFER_SOURCE/);
  assert.throws(() => recordQuoteOffer({ ...context, entry: { ...entry, insurerReference: " " } }),
    /INVALID_OFFER_REFERENCE/);
  assert.throws(() => recordQuoteOffer({ ...context, entry: { ...entry, validUntil: "2026-09-27" } }),
    /INVALID_OFFER_VALIDITY/);
  assert.throws(() => recordQuoteOffer({ ...context, entry: { ...entry, validUntil: "2026-02-30" } }),
    /INVALID_OFFER_VALIDITY/);
});

test("no mezcla ni duplica referencias al comparar", () => {
  const offer = recordQuoteOffer({ ...context, entry });
  assert.throws(() => offersForCase([offer, { ...offer, id: "offer-2" }], "msg-2", "home"),
    /DUPLICATE_OFFER_REFERENCE/);
});
