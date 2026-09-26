export type EvidenceKind = "resource" | "provider_receipt" | "sensor" |
  "hash" | "event" | "human" | "custom";
export interface EvidenceReference {
  kind: EvidenceKind;
  reference: string;
  hash?: string;
  metadata: Record<string, unknown>;
}
