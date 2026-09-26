import { InMemoryResourceRegistry, mintResourceId, type RegisterResourceInput } from "@agent-world/resources";
import { defaultFlowRules, FlowEngine, InMemoryDataFlowStore,
  InMemoryReleaseApprovalStore, InMemoryTaskWorkingSetStore, SinkRegistry,
  type Confidentiality, type DataCategory, type DataLabel } from "../src/index.js";

export const fileId = mintResourceId("file", "workspace/source");
export const emailSink = mintResourceId("sink_email", "demo/external");
export const publicSink = mintResourceId("sink_http", "demo/public");
export const cloudModelSink = mintResourceId("service", "demo/cloud-model");
export const unknownSink = mintResourceId("sink_http", "demo/unknown");

export function label(confidentiality: Confidentiality, categories: DataCategory[] = [],
  releasable = true): DataLabel {
  return { confidentiality, categories, releasable,
    jurisdictions: [], ownerPrincipalIds: [], metadata: {} };
}

export function fixture() {
  let now = 100;
  const resources = new InMemoryResourceRegistry();
  for (const [id, kind, trust] of [
    [fileId, "file", null], [emailSink, "sink_email", "external"],
    [publicSink, "sink_http", "public"], [cloudModelSink, "service", "external"],
    [unknownSink, "sink_http", null]
  ] as const) {
    resources.register({ id, kind, displayName: id, aliases: [], parentId: null,
      dataLabel: null, exclusivity: "shared", source: "host",
      sink: trust ? { external: true, trustClass: trust, allowedSensitivity: ["public"] } : null
    } as RegisterResourceInput);
  }
  const sinks = new SinkRegistry(resources);
  sinks.register({ id: emailSink, kind: "email", trust: "external", hostControlled: true, metadata: {} });
  sinks.register({ id: publicSink, kind: "webhook", trust: "public", hostControlled: true, metadata: {} });
  sinks.register({ id: cloudModelSink, kind: "model_provider", trust: "external",
    hostControlled: true, metadata: {} });
  sinks.register({ id: unknownSink, kind: "webhook", trust: "unknown",
    hostControlled: true, metadata: {} });
  const objects = new InMemoryDataFlowStore();
  const workingSets = new InMemoryTaskWorkingSetStore(objects);
  const approvals = new InMemoryReleaseApprovalStore();
  const engine = new FlowEngine(objects, workingSets, sinks, approvals, defaultFlowRules(), () => now);
  const add = (id: string, dataLabel: DataLabel | null, taskId = "task-1") => {
    objects.addSource({ id, taskId, resourceId: fileId, label: dataLabel,
      origin: "resource", createdAt: now, metadata: {} });
    workingSets.add(taskId, id, workingSets.get(taskId).version);
  };
  const request = (objectIds: string[], sinkId = emailSink, taskId = "task-1",
    intentId = "intent-1") => ({ objectIds, sinkId, taskId, intentId });
  return { resources, sinks, objects, workingSets, approvals, engine, add, request,
    setNow: (value: number) => { now = value; } };
}
