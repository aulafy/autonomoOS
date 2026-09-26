import { isCanonicalResourceId } from "@agent-world/resources";
import { joinDataLabels, validateLabel } from "./labels.js";
import { FlowError, type DataLineageEdge, type DataObjectRef } from "./types.js";

export interface DataFlowStore {
  addSource(object: DataObjectRef): DataObjectRef;
  derive(input: Omit<DataObjectRef, "label" | "origin">,
    sourceObjectIds: readonly string[], operation: DataLineageEdge["operation"]): DataObjectRef;
  get(id: string): DataObjectRef | null;
  listByTask(taskId: string): readonly DataObjectRef[];
  lineageFor(objectId: string): readonly DataLineageEdge[];
}

export class InMemoryDataFlowStore implements DataFlowStore {
  private readonly objects = new Map<string, DataObjectRef>();
  private readonly edges = new Map<string, DataLineageEdge>();

  addSource(object: DataObjectRef): DataObjectRef {
    this.validateObject(object);
    if (object.origin === "derived") throw new FlowError("INVALID_DATA_ORIGIN");
    if (this.objects.has(object.id)) throw new FlowError("DATA_OBJECT_EXISTS");
    const stored = structuredClone(object);
    this.objects.set(stored.id, stored);
    return structuredClone(stored);
  }

  derive(input: Omit<DataObjectRef, "label" | "origin">,
    sourceObjectIds: readonly string[], operation: DataLineageEdge["operation"]): DataObjectRef {
    if (!sourceObjectIds.length || new Set(sourceObjectIds).size !== sourceObjectIds.length ||
      !["summarize", "translate", "paraphrase", "format", "llm_output", "combine"]
        .includes(operation)) throw new FlowError("INVALID_LINEAGE");
    if (this.objects.has(input.id)) throw new FlowError("DATA_OBJECT_EXISTS");
    const sources = sourceObjectIds.map(id => this.objects.get(id));
    if (sources.some(source => !source || source.taskId !== input.taskId || !source.label)) {
      throw new FlowError("UNKNOWN_LINEAGE_SOURCE");
    }
    const label = joinDataLabels(sources.map(source => source!.label!));
    const object: DataObjectRef = { ...input, label, origin: "derived" };
    this.validateObject(object);
    const stored = structuredClone(object);
    this.objects.set(stored.id, stored);
    sourceObjectIds.forEach((sourceObjectId, index) => {
      const edge: DataLineageEdge = { id: `${stored.id}:${index}`, taskId: stored.taskId,
        sourceObjectId, derivedObjectId: stored.id, operation, createdAt: stored.createdAt };
      this.edges.set(edge.id, edge);
    });
    return structuredClone(stored);
  }

  get(id: string): DataObjectRef | null {
    const object = this.objects.get(id);
    return object ? structuredClone(object) : null;
  }
  listByTask(taskId: string): readonly DataObjectRef[] {
    return [...this.objects.values()].filter(object => object.taskId === taskId)
      .map(object => structuredClone(object));
  }
  lineageFor(objectId: string): readonly DataLineageEdge[] {
    return [...this.edges.values()].filter(edge => edge.derivedObjectId === objectId)
      .map(edge => structuredClone(edge));
  }

  private validateObject(object: DataObjectRef): void {
    if (!object?.id || !object.taskId || !Number.isFinite(object.createdAt) ||
      object.createdAt < 0 || (object.resourceId && !isCanonicalResourceId(object.resourceId)) ||
      !object.metadata || typeof object.metadata !== "object" || Array.isArray(object.metadata)) {
      throw new FlowError("INVALID_DATA_OBJECT");
    }
    if (object.label) validateLabel(object.label);
  }
}
