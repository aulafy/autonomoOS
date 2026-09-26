import type { CompositionRule, CompositionRuleResult, CompositionCandidate,
  HistoryFact } from "./types.js";

function rule(id: string, predicate: (history: readonly HistoryFact[],
  candidate: CompositionCandidate) => boolean,
  verdict: CompositionRuleResult["verdict"]): CompositionRule {
  return { id, version: "1", evaluate(history, candidate) {
    const matched = predicate(history, candidate);
    return { ruleId: id, verdict: matched ? verdict : "allow",
      reason: matched ? id : "NO_MATCH" };
  } };
}

const has = (history: readonly HistoryFact[], kind: HistoryFact["kind"]) =>
  history.some(fact => fact.kind === kind);

export function defaultCompositionRules(): readonly CompositionRule[] {
  return [
    rule("SENSITIVE_READ_EXTERNAL_SEND", (h, c) => c.actionClass === "external_send" &&
      has(h, "sensitive_read"), "require_approval"),
    rule("SECRET_PUBLIC_PUBLISH", (h, c) => c.actionClass === "public_publish" &&
      has(h, "secret_observed"), "deny"),
    rule("CREDENTIAL_CONTEXT_PUBLIC_PUBLISH", (h, c) => c.actionClass === "public_publish" &&
      has(h, "credential_access"), "deny"),
    rule("CREDENTIAL_UNTRUSTED_CODE", (h, c) => c.actionClass === "untrusted_code_execution" &&
      has(h, "credential_access"), "require_approval"),
    rule("REPEATED_PAYMENT_ATTEMPT", (h, c) => c.actionClass === "payment" &&
      has(h, "payment_attempted"), "require_approval"),
    rule("UNTRUSTED_CODE_ROBOT", (h, c) => c.actionClass === "robot_action" &&
      has(h, "untrusted_code_executed"), "require_approval"),
    rule("UNKNOWN_SINK_TRUST", (_h, c) =>
      ["external_send", "public_publish"].includes(c.actionClass) &&
      c.sinkTrust === "unknown", "require_approval")
  ];
}
