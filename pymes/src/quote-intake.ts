import type { InsuranceLine } from "./config.js";

export interface QuoteRequirement {
  id: string;
  label: string;
  externalOnly?: boolean;
}

export const quoteRequirements: Record<InsuranceLine, readonly QuoteRequirement[]> = {
  auto: [
    { id: "vehicleUse", label: "Vehículo y uso" },
    { id: "drivers", label: "Conductores habituales" },
    { id: "coverage", label: "Coberturas deseadas" },
    { id: "startDate", label: "Fecha de inicio" }
  ],
  life: [
    { id: "capital", label: "Capital y finalidad" },
    { id: "insuredPeople", label: "Personas a asegurar" },
    { id: "startDate", label: "Fecha de inicio" },
    { id: "insurerQuestionnaire", label: "Cuestionario de la aseguradora, por canal autorizado", externalOnly: true }
  ],
  home: [
    { id: "propertyUse", label: "Vivienda y uso" },
    { id: "insuredCapital", label: "Capitales a asegurar" },
    { id: "coverage", label: "Coberturas deseadas" },
    { id: "startDate", label: "Fecha de inicio" }
  ],
  selfEmployedLiability: [
    { id: "activity", label: "Actividad profesional" },
    { id: "scope", label: "Ámbito de cobertura" },
    { id: "limits", label: "Límites deseados" },
    { id: "startDate", label: "Fecha de inicio" }
  ]
};

export type IntakeStatus = "identity_required" | "line_required" | "collecting" |
  "preliminary_complete" | "external_step_required";

export function evaluateQuoteIntake(input: {
  line?: InsuranceLine;
  identityStatus: "linked" | "unidentified";
  checkedIds: ReadonlySet<string>;
}): { status: IntakeStatus; checked: number; total: number; externalSteps: string[] } {
  if (!input.line) return { status: input.identityStatus === "unidentified"
    ? "identity_required" : "line_required", checked: 0, total: 0, externalSteps: [] };
  const requirements = quoteRequirements[input.line];
  const local = requirements.filter(requirement => !requirement.externalOnly);
  const validIds = new Set(local.map(requirement => requirement.id));
  for (const id of input.checkedIds) {
    if (!validIds.has(id)) throw new Error(`INVALID_QUOTE_CHECK:${id}`);
  }
  const checked = input.checkedIds.size;
  const externalSteps = requirements.filter(requirement => requirement.externalOnly)
    .map(requirement => requirement.label);
  const status: IntakeStatus = input.identityStatus === "unidentified" ? "identity_required" :
    checked < local.length ? "collecting" :
      externalSteps.length ? "external_step_required" : "preliminary_complete";
  return { status, checked, total: local.length, externalSteps };
}
