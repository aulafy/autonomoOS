import type { ResourceKind } from "./kinds.js";
import { isCanonicalResourceId, kindFromResourceId, type ResourceId } from "./resource-id.js";
import { cloneResource, type RegisterResourceInput, type ResourceRecord } from "./resource.js";
import type { ResourceRegistry } from "./resource-registry.js";
import { normalizeAlias } from "./resource-resolver.js";

function uniqueAliases(values: readonly string[]): string[] {
  return [...new Set(values.map(normalizeAlias).filter(Boolean))];
}

export class InMemoryResourceRegistry implements ResourceRegistry {
  private readonly byId = new Map<ResourceId, ResourceRecord>();
  private readonly aliasIndex = new Map<string, Set<ResourceId>>();
  private mutationGeneration = 0;

  register(input: RegisterResourceInput): ResourceRecord {
    this.validate(input);
    if (this.byId.has(input.id)) throw new Error(`resource_already_registered:${input.id}`);
    const now = Date.now();
    const record: ResourceRecord = {
      ...this.copyInput(input), aliases: uniqueAliases([input.displayName, ...input.aliases]),
      version: 1, generation: input.generation ?? 1,
      registeredAt: input.registeredAt ?? now, updatedAt: input.updatedAt ?? now
    };
    this.byId.set(record.id, record);
    this.indexAliases(record);
    this.mutationGeneration++;
    return cloneResource(record);
  }

  update(input: RegisterResourceInput, expectedVersion: number): ResourceRecord {
    const current = this.byId.get(input.id);
    if (!current) throw new Error(`resource_not_registered:${input.id}`);
    if (current.version !== expectedVersion) throw new Error(`resource_version_conflict:${input.id}`);
    this.validate(input);
    if (input.generation !== undefined && input.generation < current.generation) {
      throw new Error(`resource_generation_regression:${input.id}`);
    }
    const next: ResourceRecord = {
      ...this.copyInput(input), aliases: uniqueAliases([input.displayName, ...input.aliases]),
      version: current.version + 1, generation: input.generation ?? current.generation,
      registeredAt: current.registeredAt, updatedAt: input.updatedAt ?? Date.now()
    };
    this.unindexAliases(current);
    this.byId.set(next.id, next);
    this.indexAliases(next);
    this.mutationGeneration++;
    return cloneResource(next);
  }

  get(id: ResourceId): ResourceRecord | null {
    const value = this.byId.get(id);
    return value ? cloneResource(value) : null;
  }
  has(id: ResourceId): boolean { return this.byId.has(id); }
  list(): readonly ResourceRecord[] { return [...this.byId.values()].map(cloneResource); }
  listByKind(kind: ResourceKind): readonly ResourceRecord[] {
    return this.list().filter(resource => resource.kind === kind);
  }
  findByAlias(alias: string): readonly ResourceRecord[] {
    const ids = this.aliasIndex.get(normalizeAlias(alias));
    return ids ? [...ids].flatMap(id => {
      const resource = this.get(id);
      return resource ? [resource] : [];
    }) : [];
  }
  registryGeneration(): number { return this.mutationGeneration; }

  private validate(input: RegisterResourceInput): void {
    if (!isCanonicalResourceId(input.id)) throw new Error(`invalid_resource_id:${input.id}`);
    if (input.kind !== kindFromResourceId(input.id)) throw new Error(`kind_id_mismatch:${input.id}`);
    if (input.parentId && !this.byId.has(input.parentId)) {
      throw new Error(`parent_resource_not_registered:${input.parentId}`);
    }
    if (input.parentId === input.id) throw new Error(`resource_parent_cycle:${input.id}`);
    let ancestor = input.parentId;
    while (ancestor) {
      if (ancestor === input.id) throw new Error(`resource_parent_cycle:${input.id}`);
      ancestor = this.byId.get(ancestor)?.parentId ?? null;
    }
    if (input.generation !== undefined && (!Number.isInteger(input.generation) || input.generation < 1)) {
      throw new Error(`invalid_resource_generation:${input.id}`);
    }
  }
  private copyInput(input: RegisterResourceInput): Omit<ResourceRecord,
    "version" | "generation" | "registeredAt" | "updatedAt"> {
    return {
      id: input.id, kind: input.kind, displayName: input.displayName,
      aliases: [...input.aliases], parentId: input.parentId,
      ownerPrincipalId: input.ownerPrincipalId,
      dataLabel: input.dataLabel ? structuredClone(input.dataLabel) : null,
      exclusivity: input.exclusivity, sink: input.sink ? structuredClone(input.sink) : null,
      source: input.source, metadata: structuredClone(input.metadata ?? {})
    };
  }
  private indexAliases(resource: ResourceRecord): void {
    for (const alias of resource.aliases) {
      const ids = this.aliasIndex.get(alias) ?? new Set<ResourceId>();
      ids.add(resource.id);
      this.aliasIndex.set(alias, ids);
    }
  }
  private unindexAliases(resource: ResourceRecord): void {
    for (const alias of resource.aliases) {
      const ids = this.aliasIndex.get(alias);
      ids?.delete(resource.id);
      if (ids?.size === 0) this.aliasIndex.delete(alias);
    }
  }
}
