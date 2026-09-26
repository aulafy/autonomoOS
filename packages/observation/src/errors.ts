export type ObservationErrorCode = "OBSERVER_NOT_FOUND" | "OBSERVER_ALREADY_REGISTERED" |
  "INVALID_OBSERVER_RESULT" | "OBSERVATION_SUBJECT_MISMATCH" |
  "POSTCONDITION_MISMATCH" | "DUPLICATE_OBSERVATION_ID";
export class ObservationError extends Error {
  constructor(readonly code: ObservationErrorCode, detail?: string) {
    super(detail ? `${code}:${detail}` : code);
    this.name = "ObservationError";
  }
}
