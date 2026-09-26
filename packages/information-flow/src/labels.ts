import { FlowError, type Confidentiality, type DataLabel } from "./types.js";

export const CONFIDENTIALITY_RANK: Readonly<Record<Confidentiality, number>> = {
  public: 0, internal: 1, confidential: 2, restricted: 3, secret: 4
};

export function validateLabel(label: DataLabel): void {
  if (!label || !Object.hasOwn(CONFIDENTIALITY_RANK, label.confidentiality) ||
    !Array.isArray(label.categories) || !Array.isArray(label.jurisdictions) ||
    !Array.isArray(label.ownerPrincipalIds) || typeof label.releasable !== "boolean" ||
    !label.metadata || typeof label.metadata !== "object" || Array.isArray(label.metadata)) {
    throw new FlowError("INVALID_DATA_LABEL");
  }
}

export function joinDataLabels(labels: readonly DataLabel[]): DataLabel {
  if (!labels.length) throw new FlowError("MISSING_DATA_LABEL");
  labels.forEach(validateLabel);
  const confidentiality = labels.reduce<Confidentiality>((max, label) =>
    CONFIDENTIALITY_RANK[label.confidentiality] > CONFIDENTIALITY_RANK[max]
      ? label.confidentiality : max, "public");
  const combine = <T>(selector: (label: DataLabel) => readonly T[]) =>
    [...new Set(labels.flatMap(label => [...selector(label)]))];
  return { confidentiality, categories: combine(label => label.categories),
    jurisdictions: combine(label => label.jurisdictions),
    ownerPrincipalIds: combine(label => label.ownerPrincipalIds),
    releasable: labels.every(label => label.releasable), metadata: {} };
}
