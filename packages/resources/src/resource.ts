import type { ResourceKind } from "./kinds.js";
import type { ResourceId } from "./resource-id.js";

export type DataSensitivity = "public" | "internal" | "confidential" | "restricted" | "secret";
export interface ResourceDataLabel {
  sensitivity: DataSensitivity;
  categories: string[];
  source: "host" | "organization_policy" | "user" | "trusted_classifier";
  classifiedAt: number;
}
export interface ResourceSinkMetadata {
  external: boolean;
  trustClass: "local" | "trusted" | "external" | "public";
  destination?: string;
  allowedSensitivity: DataSensitivity[];
}
export type ResourceExclusivity = "shared" | "exclusive" | "single_writer";
export type ResourceSource = "host" | "world_adapter" | "filesystem_resolver" |
  "protocol_adapter" | "organization_directory" | "hardware_inventory" | "cloud_provider";

export interface ResourceRecord {
  id: ResourceId;
  kind: ResourceKind;
  displayName: string;
  aliases: string[];
  parentId: ResourceId | null;
  ownerPrincipalId?: string;
  dataLabel: ResourceDataLabel | null;
  exclusivity: ResourceExclusivity;
  sink: ResourceSinkMetadata | null;
  version: number;
  generation: number;
  registeredAt: number;
  updatedAt: number;
  source: ResourceSource;
  metadata: Record<string, unknown>;
}

export interface RegisterResourceInput extends Omit<ResourceRecord,
  "version" | "generation" | "registeredAt" | "updatedAt" | "metadata"> {
  generation?: number;
  registeredAt?: number;
  updatedAt?: number;
  metadata?: Record<string, unknown>;
}

export function cloneResource(resource: ResourceRecord): ResourceRecord {
  return structuredClone(resource);
}
