import { createHash } from "node:crypto";
import { CapabilityRegistry } from "@agent-world/capabilities";
import { validateActorDescriptor } from "@agent-world/execution-providers";
import type { RoutingRequest, RoutingDecision, CandidateScore } from "./types.js";
export const defaultRoutingWeights = { capabilityFit: 1, reliability: 0.8, privacyFit: 1, contextLocality: 0.4, cost: 0.3, latency: 0.2 };
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const ensure = (condition: unknown): void => { if (!condition) throw new Error("INVALID_ROUTING_INPUT"); };
const unit = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;
const trust = { untrusted: 0, restricted: 1, trusted: 2 };
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export function canonicalRouting(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalRouting).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => compare(a,b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalRouting(item)}`).join(",")}}`;
  ensure(value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value));
  return JSON.stringify(value);
}
/** Pure, reproducible admission/ranking. Reservations and execution belong to the governed host. */
export function route(request: RoutingRequest, capabilities = new CapabilityRegistry()): RoutingDecision {
  const input = structuredClone(request);
  canonicalRouting(input);
  ensure(identifier(input.taskId) && identifier(input.workUnit.id) && identifier(input.policySnapshotRef) && Number.isFinite(input.decidedAt) && input.decidedAt >= 0);
  ensure(["pinned", "deterministic"].includes(input.mode));
  ensure(input.mode !== "pinned" || input.pin && (identifier(input.pin.actorId) || identifier(input.pin.providerId)));
  if (input.pin) { if (input.pin.actorId !== undefined) ensure(identifier(input.pin.actorId)); if (input.pin.providerId !== undefined) ensure(identifier(input.pin.providerId)); }
  ensure(Object.hasOwn(trust, input.constraints.minimumTrust));
  if (input.constraints.requiredLocality !== undefined) ensure(["local", "remote"].includes(input.constraints.requiredLocality));
  if (input.constraints.allowedResidencies !== undefined) ensure(Array.isArray(input.constraints.allowedResidencies) && input.constraints.allowedResidencies.length > 0 && input.constraints.allowedResidencies.every(identifier));
  if (input.constraints.maxLatencyMs !== undefined) ensure(Number.isFinite(input.constraints.maxLatencyMs) && input.constraints.maxLatencyMs >= 0);
  ensure(/^[A-Z]{3}$/.test(input.budget.currency) && identifier(input.budget.snapshotRef) && Number.isFinite(input.budget.remaining) && input.budget.remaining >= 0);
  ensure(["capabilityFit", "reliability", "contextLocality", "privacyFit", "cost", "latency"].every(key => Number.isFinite(input.weights[key as keyof typeof input.weights]) && input.weights[key as keyof typeof input.weights] >= 0 && input.weights[key as keyof typeof input.weights] <= 1000));
  ensure(Object.values(input.weights).some(value => value > 0));
  ensure(Number.isFinite(input.normalization.cost) && input.normalization.cost > 0 && Number.isFinite(input.normalization.latencyMs) && input.normalization.latencyMs > 0);
  ensure(Array.isArray(input.workUnit.requiredCapabilities) && Array.isArray(input.workUnit.constraints) && Array.isArray(input.candidates));
  ensure(new Set(input.workUnit.requiredCapabilities.map(value => value.capability)).size === input.workUnit.requiredCapabilities.length);
  for (const requirement of input.workUnit.requiredCapabilities) ensure(capabilities.has(requirement.capability) && (requirement.minimumLevel === undefined || unit(requirement.minimumLevel)));
  for (const constraint of input.workUnit.constraints) ensure(identifier(constraint.id) && identifier(constraint.ruleRef));
  ensure(new Set(input.candidates.map(value => value.actor.id)).size === input.candidates.length);
  input.candidates.sort((a,b) => compare(a.actor.id,b.actor.id));
  const considered: CandidateScore[] = input.candidates.map(candidate => {
    const actor = candidate.actor; validateActorDescriptor(actor, actor.providerId);
    ensure(identifier(actor.providerId) && unit(candidate.reliability) && unit(candidate.contextLocality));
    ensure([candidate.policyAllowed,candidate.informationFlowAllowed,candidate.resourceAccessAllowed].every(value => typeof value === "boolean"));
    ensure(Array.isArray(candidate.satisfiedRuleRefs) && candidate.satisfiedRuleRefs.every(identifier));
    ensure(candidate.providerAvailability && ["available", "degraded", "unavailable"].includes(candidate.providerAvailability.status));
    const reasons: string[] = [], confidences: number[] = [];
    if (candidate.providerAvailability.status !== "available") reasons.push("provider_unavailable");
    if (actor.availability !== "available") reasons.push("actor_unavailable");
    if (!candidate.policyAllowed) reasons.push("policy_denied");
    if (!candidate.informationFlowAllowed) reasons.push("information_flow_denied");
    if (!candidate.resourceAccessAllowed) reasons.push("resource_access_denied");
    if (input.pin?.actorId && input.pin.actorId !== actor.id || input.pin?.providerId && input.pin.providerId !== actor.providerId) reasons.push("pin_mismatch");
    if (trust[actor.trustProfile.level] < trust[input.constraints.minimumTrust]) reasons.push("trust_insufficient");
    if (input.constraints.requiredLocality && actor.privacyProfile.locality !== input.constraints.requiredLocality) reasons.push("locality_required");
    if (input.constraints.allowedResidencies && (!actor.privacyProfile.dataResidency.length || actor.privacyProfile.dataResidency.some(value => !input.constraints.allowedResidencies!.includes(value)))) reasons.push("residency_denied_or_unknown");
    for (const requirement of input.workUnit.requiredCapabilities) {
      const supplied = actor.capabilities.find(value => value.capability === requirement.capability);
      if (!supplied || supplied.confidence <= 0 || supplied.confidence < (requirement.minimumLevel ?? 0)) reasons.push("capability_insufficient");
      else {
        confidences.push(supplied.confidence);
        if (supplied.constraints?.some(value => !candidate.satisfiedRuleRefs.includes(value.ruleRef))) reasons.push("capability_constraint_unsatisfied");
      }
    }
    if (input.workUnit.constraints.some(value => !candidate.satisfiedRuleRefs.includes(value.ruleRef))) reasons.push("work_unit_constraint_unsatisfied");
    const cost = actor.costProfile.estimatedCost, latency = actor.latencyProfile.estimatedMs;
    if (cost === null) reasons.push("cost_unknown");
    else if (actor.costProfile.currency !== input.budget.currency) reasons.push("budget_currency_mismatch");
    else if (cost > input.budget.remaining) reasons.push("budget_insufficient");
    if (input.constraints.maxLatencyMs !== undefined && (latency === null || latency > input.constraints.maxLatencyMs)) reasons.push("latency_constraint_unsatisfied");
    if (reasons.length) return { actorId: actor.id, providerId: actor.providerId, eligible: false, reasonCodes: [...new Set(reasons)].sort(compare), score: null };
    const components = { capabilityFit: confidences.length ? confidences.reduce((a,b) => a+b,0)/confidences.length : 1, reliability: candidate.reliability, contextLocality: candidate.contextLocality,
      privacyFit: actor.privacyProfile.locality === "local" ? 1 : 0.5, normalizedCost: Math.min(1,cost!/input.normalization.cost), normalizedLatency: latency === null ? 1 : Math.min(1,latency/input.normalization.latencyMs) };
    const w = input.weights;
    const score = components.capabilityFit*w.capabilityFit + components.reliability*w.reliability + components.contextLocality*w.contextLocality + components.privacyFit*w.privacyFit - components.normalizedCost*w.cost - components.normalizedLatency*w.latency;
    return { actorId: actor.id, providerId: actor.providerId, eligible: true, reasonCodes: ["eligible"], score, components };
  });
  const eligible = considered.filter(value => value.eligible).sort((a,b) => b.score!-a.score! || compare(a.actorId,b.actorId) || compare(a.providerId,b.providerId));
  const selected = eligible[0];
  const status = selected ? "selected" : input.mode === "pinned" ? "pinned-actor-invalid" : "no-eligible-actor";
  const content = { taskId: input.taskId, workUnitId: input.workUnit.id, mode: input.mode, status,
    ...(selected ? { selectedProviderId: selected.providerId, selectedActorId: selected.actorId } : {}), considered,
    reasonCodes: selected ? [input.mode === "pinned" ? "valid_pin" : "highest_eligible_score", ...(eligible[1]?.score === selected.score ? ["actor_id_tie_break"] : [])] : [status],
    policySnapshotRef: input.policySnapshotRef, decidedAt: input.decidedAt, input, capabilitySnapshot: capabilities.snapshot() };
  const id = `routing:${createHash("sha256").update(canonicalRouting(content)).digest("hex")}`;
  return { id, ...content } as RoutingDecision;
}
