import type { InsuranceLine } from "./config.js";
import type { IntakeStatus } from "./quote-intake.js";

export interface QuoteOffer {
  id: string;
  caseId: string;
  line: InsuranceLine;
  insurer: string;
  insurerReference: string;
  sourceDocument: string;
  annualPremiumCents: number;
  validUntil: string;
  coverageSummary: string;
  exclusionsSummary: string;
  enteredAt: string;
  source: "operator_transcription";
}

export interface OfferEntry {
  insurer: string;
  insurerReference: string;
  sourceDocument: string;
  annualPremium: string;
  validUntil: string;
  coverageSummary: string;
  exclusionsSummary: string;
}

function required(value: string, field: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) throw new Error(`INVALID_OFFER_${field}`);
  return trimmed;
}

export function parseEuroCents(value: string): number {
  if (!/^\d{1,7}(?:[,.]\d{1,2})?$/.test(value.trim())) {
    throw new Error("INVALID_OFFER_PREMIUM");
  }
  const [euros, decimals = ""] = value.trim().replace(",", ".").split(".");
  const cents = Number(euros) * 100 + Number(decimals.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error("INVALID_OFFER_PREMIUM");
  return cents;
}

/** Records an operator transcription; it cannot assert insurer verification or recommend a product. */
export function recordQuoteOffer(input: {
  id: string;
  caseId: string;
  line: InsuranceLine;
  intakeStatus: IntakeStatus;
  entry: OfferEntry;
  enteredAt: string;
}): QuoteOffer {
  if (input.intakeStatus !== "preliminary_complete") throw new Error("OFFER_INTAKE_INCOMPLETE");
  if (!input.id || !input.caseId || Number.isNaN(Date.parse(input.enteredAt))) {
    throw new Error("INVALID_OFFER_CONTEXT");
  }
  const date = input.entry.validUntil;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ||
    new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date ||
    date < input.enteredAt.slice(0, 10)) throw new Error("INVALID_OFFER_VALIDITY");
  return {
    id: input.id,
    caseId: input.caseId,
    line: input.line,
    insurer: required(input.entry.insurer, "INSURER", 120),
    insurerReference: required(input.entry.insurerReference, "REFERENCE", 120),
    sourceDocument: required(input.entry.sourceDocument, "SOURCE", 240),
    annualPremiumCents: parseEuroCents(input.entry.annualPremium),
    validUntil: date,
    coverageSummary: required(input.entry.coverageSummary, "COVERAGE", 600),
    exclusionsSummary: required(input.entry.exclusionsSummary, "EXCLUSIONS", 600),
    enteredAt: input.enteredAt,
    source: "operator_transcription"
  };
}

export function offersForCase(offers: readonly QuoteOffer[], caseId: string,
  line: InsuranceLine): QuoteOffer[] {
  const selected = offers.filter(offer => offer.caseId === caseId && offer.line === line);
  const references = new Set<string>();
  for (const offer of selected) {
    const key = `${offer.insurer.toLocaleLowerCase("es")}:${offer.insurerReference}`;
    if (references.has(key)) throw new Error("DUPLICATE_OFFER_REFERENCE");
    references.add(key);
  }
  return selected;
}
