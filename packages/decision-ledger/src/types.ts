import type { JsonValue } from "@agent-world/task-runtime";
export interface ActorRef { id: string; kind: "host" | "human" | "actor"; providerId?: string }
export interface RecordProvenance {
  sourceRef: string; sourceDigest?: string; dataObjectId?: string;
  operation: "created" | "derived" | "observed" | "imported";
  actor: ActorRef; createdAt: number;
}
/** Descriptive authority; the governed host must validate actual authorization. */
export interface DecisionAuthority { principalId: string; role: string; authorizationRef: string }
export interface DecisionRecord {
  id: string; taskId: string; workUnitId?: string; question: string; choice: JsonValue;
  rationale?: string; madeBy: ActorRef; authority: DecisionAuthority;
  evidenceRefs: string[]; supersedes?: string; provenance: RecordProvenance[]; createdAt: number;
}
