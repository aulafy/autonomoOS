export type EffectErrorCode =
  | "EFFECT_NOT_FOUND" | "EFFECT_ALREADY_EXISTS" | "EFFECT_IDEMPOTENCY_CONFLICT"
  | "INVALID_EFFECT_TRANSITION" | "VERSION_CONFLICT" | "INVALID_EFFECT_INPUT"
  | "EFFECT_NOT_PREPARED" | "EFFECT_NOT_DISPATCHING"
  | "OBSERVATION_NOT_FOUND" | "OBSERVATION_EFFECT_MISMATCH"
  | "OBSERVATION_SUBJECT_MISMATCH" | "OBSERVATION_NOT_ACCEPTED"
  | "OBSERVER_NOT_FOUND" | "INVALID_NO_EFFECT_CERTIFICATE";
export class EffectError extends Error {
  constructor(readonly code: EffectErrorCode, detail?: string) {
    super(detail ? `${code}:${detail}` : code);
    this.name = "EffectError";
  }
}
