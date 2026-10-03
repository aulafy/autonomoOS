import type { ActorDescriptor, ProviderAvailability } from "@agent-world/execution-providers";
import type { WorkUnitDefinition } from "@agent-world/task-runtime";
export interface RoutingWeights { capabilityFit: number; reliability: number; contextLocality: number; privacyFit: number; cost: number; latency: number }
export interface RoutingCandidate {
  actor: ActorDescriptor; providerAvailability: ProviderAvailability;
  /** Trusted host evaluations at policySnapshotRef; scores never authorize effects. */
  policyAllowed: boolean; informationFlowAllowed: boolean; resourceAccessAllowed: boolean;
  satisfiedRuleRefs: string[]; reliability: number; contextLocality: number;
}
export interface RoutingRequest {
  taskId: string; workUnit: WorkUnitDefinition; policySnapshotRef: string; decidedAt: number;
  mode: "pinned" | "deterministic"; pin?: { actorId?: string; providerId?: string };
  candidates: RoutingCandidate[];
  constraints: { requiredLocality?: "local" | "remote"; allowedResidencies?: string[]; minimumTrust: "untrusted" | "restricted" | "trusted"; maxLatencyMs?: number };
  budget: { currency: string; remaining: number; snapshotRef: string };
  weights: RoutingWeights; normalization: { cost: number; latencyMs: number };
}
export interface CandidateScore {
  actorId: string; providerId: string; eligible: boolean; reasonCodes: string[]; score: number | null;
  components?: { capabilityFit: number; reliability: number; contextLocality: number; privacyFit: number; normalizedCost: number; normalizedLatency: number };
}
export interface RoutingDecision {
  id: string; taskId: string; workUnitId: string; mode: RoutingRequest["mode"];
  status: "selected" | "no-eligible-actor" | "pinned-actor-invalid";
  selectedProviderId?: string; selectedActorId?: string;
  considered: CandidateScore[]; reasonCodes: string[]; policySnapshotRef: string; decidedAt: number;
  input: RoutingRequest; capabilitySnapshot: Array<{ id: string; description: string }>;
}
