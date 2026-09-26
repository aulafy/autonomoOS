export type EffectStatus = "preparing" | "prepared" | "dispatching" |
  "committed" | "failed" | "unknown";

export const EFFECT_TRANSITIONS: Readonly<Record<EffectStatus, readonly EffectStatus[]>> = {
  preparing: ["prepared", "failed"],
  prepared: ["dispatching", "failed"],
  dispatching: ["committed", "failed", "unknown"],
  committed: [], failed: [], unknown: []
};
