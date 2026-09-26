import type { ResourceId } from "@agent-world/resources";

export type Confidentiality = "public" | "internal" | "confidential" | "restricted" | "secret";
export type DataCategory = "generic" | "personal_data" | "credential" | "financial" |
  "health" | "source_code" | "customer_data" | "proprietary" | "regulated" |
  "security_sensitive";
export interface DataLabel {
  confidentiality: Confidentiality;
  categories: DataCategory[];
  jurisdictions: string[];
  ownerPrincipalIds: string[];
  releasable: boolean;
  metadata: Record<string, unknown>;
}
export interface DataObjectRef {
  id: string;
  taskId: string;
  resourceId?: ResourceId;
  label: DataLabel | null;
  origin: "resource" | "trusted_classifier" | "derived" | "human";
  createdAt: number;
  metadata: Record<string, unknown>;
}
export interface DataLineageEdge {
  id: string;
  taskId: string;
  sourceObjectId: string;
  derivedObjectId: string;
  operation: "summarize" | "translate" | "paraphrase" | "format" | "llm_output" | "combine";
  createdAt: number;
}
export type SinkKind = "file" | "email" | "webhook" | "browser" | "api" |
  "clipboard" | "stdout" | "model_provider" | "external_agent" | "robot" | "custom";
export interface SinkDescriptor {
  id: ResourceId;
  kind: SinkKind;
  trust: "local" | "trusted" | "external" | "public" | "unknown";
  hostControlled: true;
  metadata: Record<string, unknown>;
}
export interface FlowRequest {
  taskId: string;
  intentId: string;
  objectIds: string[];
  sinkId: ResourceId;
}
export type FlowVerdict = "allow" | "require_release_approval" | "deny";
export interface FlowRuleResult { ruleId: string; verdict: FlowVerdict; reason: string; }
export interface FlowDecision extends FlowRequest {
  verdict: FlowVerdict;
  workingSetVersion: number;
  evaluatedAt: number;
  ruleResults: FlowRuleResult[];
  approvalId?: string;
}
export interface FlowRule {
  id: string;
  version: string;
  evaluate(objects: readonly DataObjectRef[], sink: SinkDescriptor): FlowRuleResult;
}
export interface DataReleaseApproval extends FlowRequest {
  id: string;
  workingSetVersion: number;
  issuedAt: number;
  expiresAt: number;
  issuerId: string;
}
export class FlowError extends Error {
  constructor(readonly code: string) { super(code); this.name = "FlowError"; }
}
