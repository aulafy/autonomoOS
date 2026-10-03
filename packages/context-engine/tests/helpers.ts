import { InMemoryResourceRegistry, mintResourceId } from "@agent-world/resources";
import { InMemoryDataFlowStore, InMemoryTaskWorkingSetStore, InMemoryReleaseApprovalStore, SinkRegistry, FlowEngine, defaultFlowRules, type DataLabel } from "@agent-world/information-flow";
import { ContextEngine, ContextEnvelopeStore, type ContextBuildRequest, type ContextSource } from "../src/index.js";
export function fixture(local = false) {
  const resources = new InMemoryResourceRegistry(), sinkId = mintResourceId("service",local ? "context/local" : "context/cloud");
  resources.register({ id: sinkId, kind: "service", displayName: "Context sink", aliases: [], parentId: null, dataLabel: null, exclusivity: "shared", source: "host", sink: { external: !local, trustClass: local ? "local" : "external", allowedSensitivity: ["public"] } });
  const sinks = new SinkRegistry(resources), actorId = local ? "local:llm" : "orca:codex", providerId = local ? "local" : "orca";
  sinks.register({ id: sinkId, kind: "model_provider", trust: local ? "local" : "external", hostControlled: true, metadata: { actorId,providerId,locality: local ? "local" : "remote" } });
  const objects = new InMemoryDataFlowStore(), workingSets = new InMemoryTaskWorkingSetStore(objects), approvals = new InMemoryReleaseApprovalStore();
  let now = 100, allowed = true;
  const flow = new FlowEngine(objects,workingSets,sinks,approvals,defaultFlowRules(),() => now);
  const catalog: ContextSource[] = [];
  const engine = new ContextEngine({ objects,flow,sinks,sources: () => structuredClone(catalog),authorize: (_request,source) => allowed && source.category !== "forbidden" });
  const add = (id: string, kind: ContextSource["kind"], value: ContextSource["value"], extra: Partial<ContextSource> = {}, label: Partial<DataLabel> = {}) => {
    const source: ContextSource = { id,objectId: `object:${id}`,taskId: "task",workUnitIds: ["unit"],kind,category: kind,locality: "any",value,...extra }; catalog.push(source);
    objects.addSource({ id: source.objectId,taskId: source.taskId,origin: "trusted_classifier",createdAt: now,metadata: {},label: { confidentiality: "public",categories: [],jurisdictions: [],ownerPrincipalIds: [],releasable: true,metadata: {},...label } });
    workingSets.add(source.taskId,source.objectId,workingSets.get(source.taskId).version);
  };
  add("goal","goal","Implement scoped fixture"); add("objective","objective","Change the requested function");
  add("decision","decision",{ choice: "Use deterministic parsing" }); add("artifact","artifact",{ artifactRef: "artifact:fixture",resourceRef: "file:fixture" });
  const request: ContextBuildRequest = { taskId: "task",workUnitId: "unit",attemptId: "attempt",actor: { id: actorId,providerId,kind: "coding-agent",capabilities: [],costProfile: { currency: "EUR",estimatedCost: 0 },latencyProfile: { estimatedMs: 1 },trustProfile: { level: "restricted" },privacyProfile: { locality: local ? "local" : "remote",dataResidency: ["ES"] },availability: "available" },
    sinkId,intentId: "intent",policySnapshotRef: "policy:1",goalRef: "goal",objectiveRef: "objective",requiredRefs: ["decision","artifact"],optionalRefs: [],version: 1,createdAt: 100 };
  return { engine,add,request,catalog,objects,workingSets,approvals, setNow(value: number) { now=value; },deny() { allowed=false; } };
}
