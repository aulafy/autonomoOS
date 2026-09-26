import type { DataObjectRef, FlowRule, FlowRuleResult, SinkDescriptor } from "./types.js";

function rule(id: string, predicate: (objects: readonly DataObjectRef[],
  sink: SinkDescriptor) => boolean, verdict: FlowRuleResult["verdict"]): FlowRule {
  return { id, version: "1", evaluate(objects, sink) {
    return { ruleId: id, verdict: predicate(objects, sink) ? verdict : "allow",
      reason: predicate(objects, sink) ? id : "NO_MATCH" };
  } };
}

const external = (sink: SinkDescriptor) =>
  sink.trust === "external" || sink.trust === "public";

export function defaultFlowRules(): readonly FlowRule[] {
  return [
    rule("SECRET_PUBLIC_DENY", (objects, sink) => sink.trust === "public" &&
      objects.some(object => object.label?.confidentiality === "secret"), "deny"),
    rule("RESTRICTED_EXTERNAL_DENY", (objects, sink) => external(sink) &&
      objects.some(object => ["restricted", "secret"].includes(object.label!.confidentiality)), "deny"),
    rule("CREDENTIAL_EXTERNAL_DENY", (objects, sink) => external(sink) &&
      objects.some(object => object.label!.categories.includes("credential")), "deny"),
    rule("PERSONAL_PUBLIC_DENY", (objects, sink) => sink.trust === "public" &&
      objects.some(object => object.label!.categories.includes("personal_data")), "deny"),
    rule("NON_RELEASABLE_EXTERNAL_DENY", (objects, sink) => external(sink) &&
      objects.some(object => !object.label!.releasable), "deny"),
    rule("CONFIDENTIAL_EXTERNAL_APPROVAL", (objects, sink) => external(sink) &&
      objects.some(object => object.label!.confidentiality === "confidential"),
      "require_release_approval")
  ];
}
