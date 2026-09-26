import type { ResourceKind } from "./kinds.js";
import type { ResourceId } from "./resource-id.js";
import type { RegisterResourceInput, ResourceRecord } from "./resource.js";

export interface ResourceRegistry {
  register(input: RegisterResourceInput): ResourceRecord;
  update(input: RegisterResourceInput, expectedVersion: number): ResourceRecord;
  get(id: ResourceId): ResourceRecord | null;
  has(id: ResourceId): boolean;
  list(): readonly ResourceRecord[];
  listByKind(kind: ResourceKind): readonly ResourceRecord[];
  findByAlias(alias: string): readonly ResourceRecord[];
  registryGeneration(): number;
}
