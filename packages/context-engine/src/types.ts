import type { ActorDescriptor } from "@agent-world/execution-providers";
import type { DataLabel, FlowDecision } from "@agent-world/information-flow";
import type { JsonValue } from "@agent-world/task-runtime";
import type { ResourceId } from "@agent-world/resources";
export type ContextKind = "goal" | "objective" | "fact" | "decision" | "artifact" | "evidence" | "constraint" | "permission";
export interface ContextSource {
  id: string; objectId: string; taskId: string; workUnitIds: string[]; kind: ContextKind;
  category: string; locality: "any" | "local-only"; value: JsonValue;
}
export interface ContextBuildRequest {
  taskId: string; workUnitId: string; attemptId: string; actor: ActorDescriptor;
  sinkId: ResourceId; intentId: string; policySnapshotRef: string;
  goalRef: string; objectiveRef: string; requiredRefs: string[]; optionalRefs: string[];
  version: number; previousEnvelopeId?: string; createdAt: number; approvalId?: string;
}
export interface ProvenanceEntry {
  sourceRef: string; objectId: string; origin: string; sourceDigest: string; label: DataLabel;
  lineage: Array<{ sourceObjectId: string; operation: string }>;
}
export interface ContextEnvelope {
  id: string; taskId: string; workUnitId: string; attemptId: string; actorId: string; providerId: string;
  goal: string; workObjective: string;
  facts: ContextSource[]; decisions: ContextSource[]; artifacts: ContextSource[]; evidence: ContextSource[];
  constraints: ContextSource[]; permissions: ContextSource[];
  sources: ContextSource[]; provenance: ProvenanceEntry[];
  excludedCategories: string[]; exclusions: Array<{ sourceRef: string; category: string; reason: string }>;
  version: number; previousEnvelopeId?: string; createdAt: number;
  policySnapshotRef: string; flow: FlowDecision; request: ContextBuildRequest;
}
export type RenderedContext = { envelopeId: string; providerId: string; format: "orca-spec" | "local-model-json" | "provider-json"; content: string };
