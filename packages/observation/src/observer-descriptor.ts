import type { ObservationSource } from "./observation.js";

export type ObservationStrength = "weak" | "moderate" | "strong";
export type ObserverIndependence = "same_executor" | "same_process" |
  "independent_local" | "independent_external" | "human";
export interface ObserverDescriptor {
  id: string;
  implementation: string;
  sourceType: ObservationSource;
  independence: ObserverIndependence;
  strength: ObservationStrength;
  authenticated: boolean;
  metadata: Record<string, unknown>;
}
