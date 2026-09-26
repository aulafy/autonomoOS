import type { ObservationStatus } from "./observation.js";
import type { ObservationStrength } from "./observer-descriptor.js";

export type ObservationReasonCode =
  | "OBSERVATION_CONFIRMED" | "OBSERVATION_CONTRADICTED"
  | "OBSERVATION_UNKNOWN" | "OBSERVATION_INCONCLUSIVE" | "OBSERVATION_STALE"
  | "OBSERVATION_SUBJECT_MISMATCH" | "POSTCONDITION_MISMATCH"
  | "INSUFFICIENT_OBSERVATION_STRENGTH" | "OBSERVATION_TOO_OLD"
  | "RESOURCE_GENERATION_CHANGED" | "RESOURCE_GENERATION_UNKNOWN"
  | "CONFLICTING_EVIDENCE";
export interface ObservationEvaluation {
  accepted: boolean;
  effectiveStatus: ObservationStatus;
  reasonCode: ObservationReasonCode;
  explanation: string;
  requiredStrength?: ObservationStrength;
  actualStrength?: ObservationStrength;
}
