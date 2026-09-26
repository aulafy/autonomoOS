import type { ResourceId } from "@agent-world/resources";
import type { EvidenceReference } from "./evidence-reference.js";
import type { ExpectedPostcondition } from "./expected-postcondition.js";
import type { ObservationSubject } from "./observation-subject.js";

export type ObservationStatus = "confirmed" | "contradicted" | "unknown" |
  "inconclusive" | "stale";
export type ObservationSource = "world" | "filesystem" | "provider" | "sensor" |
  "api" | "human" | "fixture" | "custom";
export interface Observation {
  id: string;
  subject: ObservationSubject;
  observerId: string;
  source: ObservationSource;
  status: ObservationStatus;
  observedAt: number;
  expectedPostcondition: ExpectedPostcondition;
  expectedPostconditionHash: string;
  observedResourceGenerations: Record<ResourceId, number>;
  evidence: EvidenceReference[];
  reason: string;
  metadata: Record<string, unknown>;
}
