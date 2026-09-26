import { isCanonicalResourceId, type ResourceRegistry } from "@agent-world/resources";
import { FlowError, type SinkDescriptor } from "./types.js";

export class SinkRegistry {
  private readonly sinks = new Map<string, SinkDescriptor>();
  constructor(private readonly resources: ResourceRegistry) {}

  register(sink: SinkDescriptor): SinkDescriptor {
    if (!sink?.id || !isCanonicalResourceId(sink.id) || !this.resources.has(sink.id) ||
      sink.hostControlled !== true || !["local", "trusted", "external", "public", "unknown"]
        .includes(sink.trust) ||
      !["file", "email", "webhook", "browser", "api", "clipboard", "stdout",
        "model_provider", "external_agent", "robot", "custom"].includes(sink.kind) ||
      this.sinks.has(sink.id)) throw new FlowError("INVALID_SINK_DESCRIPTOR");
    const resource = this.resources.get(sink.id)!;
    if (resource.sink && resource.sink.trustClass !== sink.trust) {
      throw new FlowError("SINK_RESOURCE_MISMATCH");
    }
    const stored = structuredClone(sink);
    this.sinks.set(stored.id, stored);
    return structuredClone(stored);
  }
  get(id: string): SinkDescriptor | null {
    const sink = this.sinks.get(id);
    return sink ? structuredClone(sink) : null;
  }
}
