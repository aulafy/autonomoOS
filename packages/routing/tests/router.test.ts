import test from "node:test";
import assert from "node:assert/strict";
import { route, defaultRoutingWeights, RoutingDecisionStore, type RoutingCandidate, type RoutingRequest } from "../src/index.js";
export function candidate(id: string, locality: "local" | "remote" = "local"): RoutingCandidate {
  return { actor: { id, providerId: `provider:${id}`, kind: "coding-agent", availability: "available", capabilities: [{ capability: "code.modify_repo", confidence: 0.9 }],
    costProfile: { currency: "EUR", estimatedCost: 1 }, latencyProfile: { estimatedMs: 1000 }, trustProfile: { level: "restricted" }, privacyProfile: { locality, dataResidency: ["ES"] } },
    providerAvailability: { status: "available", capabilities: ["execution"] }, policyAllowed: true, informationFlowAllowed: true, resourceAccessAllowed: true, satisfiedRuleRefs: [], reliability: 0.8, contextLocality: 0.9 };
}
export function request(candidates = [candidate("actor:a")]): RoutingRequest {
  return { taskId: "task", workUnit: { id: "unit", title: "Implement", objective: "Implement scoped change", dependencies: [], requiredCapabilities: [{ capability: "code.modify_repo", minimumLevel: 0.8 }], constraints: [], expectedArtifacts: [], successCriteria: [{ id: "test", kind: "test", command: "npm test", expectedExitCode: 0 }] },
    policySnapshotRef: "policy:1", decidedAt: 100, mode: "deterministic", candidates,
    constraints: { minimumTrust: "restricted" }, budget: { currency: "EUR", remaining: 10, snapshotRef: "budget:1" }, weights: { ...defaultRoutingWeights }, normalization: { cost: 10, latencyMs: 10000 } };
}
test("privacy constraints exclude the highest scoring remote actor before scoring", () => {
  const local = candidate("local"), remote = candidate("remote", "remote"); remote.reliability = 1; remote.actor.capabilities[0]!.confidence = 1;
  const input = request([local,remote]); input.constraints.requiredLocality = "local";
  const result = route(input); assert.equal(result.selectedActorId, "local");
  assert.equal(result.considered.find(value => value.actorId === "remote")!.score, null);
  assert.ok(result.considered.find(value => value.actorId === "remote")!.reasonCodes.includes("locality_required"));
});
test("policy, information flow, resource access and provider availability are hard filters", () => {
  const values = [candidate("policy"),candidate("flow"),candidate("resource"),candidate("provider"),candidate("actor")];
  values[0]!.policyAllowed = false; values[1]!.informationFlowAllowed = false; values[2]!.resourceAccessAllowed = false;
  values[3]!.providerAvailability = { status: "unavailable", reason: "offline" }; values[4]!.actor.availability = "degraded";
  const decision = route(request(values)); assert.equal(decision.status, "no-eligible-actor");
  assert.ok(decision.considered.every(value => value.score === null));
});
test("insufficient, unknown and mismatched-currency cost cannot pass budget admission", () => {
  const values = [candidate("expensive"),candidate("unknown"),candidate("currency")];
  values[0]!.actor.costProfile.estimatedCost = 11; values[1]!.actor.costProfile.estimatedCost = null; values[2]!.actor.costProfile.currency = "USD";
  const decision = route(request(values)); assert.equal(decision.status, "no-eligible-actor");
  assert.deepEqual(decision.considered.map(value => value.reasonCodes[0]), ["budget_currency_mismatch","budget_insufficient","cost_unknown"]);
});
test("invalid pinned actor fails explicitly without falling back", () => {
  const input = request(); input.mode = "pinned"; input.pin = { actorId: "missing" };
  assert.equal(route(input).status, "pinned-actor-invalid");
  input.pin = { actorId: "actor:a" }; input.candidates[0]!.policyAllowed = false;
  assert.equal(route(input).status, "pinned-actor-invalid");
});
test("valid provider pin selects only an eligible actor of that provider", () => {
  const input = request([candidate("a"),candidate("b")]); input.mode = "pinned"; input.pin = { providerId: "provider:b" };
  assert.equal(route(input).selectedActorId, "b");
});
test("equal scores and candidate permutation produce the identical decision", () => {
  const input = request([candidate("b"),candidate("a")]); const before = structuredClone(input);
  const first = route(input); assert.equal(first.selectedActorId, "a"); assert.ok(first.reasonCodes.includes("actor_id_tie_break"));
  assert.deepEqual(input,before);
  input.candidates.reverse(); assert.deepEqual(route(input),first);
  assert.deepEqual(before.candidates.map(value => value.actor.id), ["b","a"]);
});
test("capability confidence, configured constraints, trust and residency must all hold", () => {
  const input = request([candidate("confidence"),candidate("constraint"),candidate("trust"),candidate("residency")]);
  input.candidates[0]!.actor.capabilities[0]!.confidence = 0.5;
  input.candidates[1]!.actor.capabilities[0]!.constraints = [{ id: "limited", ruleRef: "rule:limited" }];
  input.candidates[2]!.actor.trustProfile.level = "untrusted";
  input.candidates[3]!.actor.privacyProfile.dataResidency = ["US"];
  input.constraints.allowedResidencies = ["ES"];
  assert.equal(route(input).status,"no-eligible-actor");
  input.candidates[1]!.satisfiedRuleRefs = ["rule:limited"];
  assert.equal(route(input).selectedActorId,"constraint");
});
test("work unit constraints and unknown latency under a hard deadline fail closed", () => {
  const input = request(); input.workUnit.constraints = [{ id: "worktree", ruleRef: "rule:worktree" }];
  assert.equal(route(input).status,"no-eligible-actor"); input.candidates[0]!.satisfiedRuleRefs = ["rule:worktree"];
  input.constraints.maxLatencyMs = 2000; input.candidates[0]!.actor.latencyProfile.estimatedMs = null;
  assert.equal(route(input).status,"no-eligible-actor");
});
test("decision records replay captured inputs and reject altered selection or explanation", () => {
  const decision = route(request()); const store = new RoutingDecisionStore();
  const receipt = store.record(decision); assert.deepEqual(store.record(decision),receipt);
  assert.equal(store.list().length,1); const copy = store.get(decision.id)!; copy.reasonCodes.push("invented");
  assert.throws(() => store.record(copy),/NOT_REPRODUCIBLE/);
  assert.deepEqual(store.get(decision.id),decision);
  assert.throws(() => store.record({ ...decision, selectedActorId: "different" }),/NOT_REPRODUCIBLE/);
});
test("malformed values, unknown requirements and ambiguous actor IDs are rejected", () => {
  for (const modify of [(value: RoutingRequest) => { value.weights.cost = NaN; }, (value: RoutingRequest) => { value.budget.remaining = -1; }, (value: RoutingRequest) => { value.workUnit.requiredCapabilities[0]!.capability = "undefined.capability"; }, (value: RoutingRequest) => { value.candidates.push(structuredClone(value.candidates[0]!)); }]) {
    const input = request(); modify(input); assert.throws(() => route(input));
  }
});
