import type { ContractRisk } from "@agent-world/contracts";
import type { ResourceRegistry } from "@agent-world/resources";
import type { Clock } from "./clock.js";
import { postconditionHash, type ExpectedPostcondition } from "./expected-postcondition.js";
import type { Observation } from "./observation.js";
import type { ObservationEvaluation } from "./observation-evaluation.js";
import type { ObservationSubject } from "./observation-subject.js";
import { sameSubject } from "./observation-subject.js";
import type { ObserverDescriptor, ObservationStrength } from "./observer-descriptor.js";

export interface ObservationRequirement {
  subject: ObservationSubject;
  expectedPostcondition: ExpectedPostcondition;
  riskClass: ContractRisk;
  maxAgeMs: number;
  requireGenerationBinding?: boolean;
}

const strengthRank: Record<ObservationStrength, number> = { weak: 0, moderate: 1, strong: 2 };
export const MINIMUM_STRENGTH_BY_RISK: Record<ContractRisk, ObservationStrength> = {
  R0: "weak", R1: "weak", R2: "moderate", R3: "moderate",
  R4: "strong", R5: "strong"
};

function effectiveStrength(descriptor: ObserverDescriptor): ObservationStrength {
  if (!descriptor.authenticated || descriptor.independence === "same_executor") return "weak";
  if (descriptor.independence === "same_process" && descriptor.strength === "strong") return "moderate";
  return descriptor.strength;
}

export class ObservationPolicy {
  constructor(private readonly clock: Clock, private readonly resources?: ResourceRegistry) {}

  evaluate(observation: Observation, descriptor: ObserverDescriptor,
    requirement: ObservationRequirement): ObservationEvaluation {
    const requiredStrength = MINIMUM_STRENGTH_BY_RISK[requirement.riskClass];
    const actualStrength = effectiveStrength(descriptor);
    const result = (accepted: boolean, effectiveStatus: ObservationEvaluation["effectiveStatus"],
      reasonCode: ObservationEvaluation["reasonCode"], explanation: string): ObservationEvaluation =>
      ({ accepted, effectiveStatus, reasonCode, explanation, requiredStrength, actualStrength });
    if (!["weak", "moderate", "strong"].includes(descriptor.strength) ||
      !["same_executor", "same_process", "independent_local", "independent_external", "human"]
        .includes(descriptor.independence) ||
      typeof descriptor.authenticated !== "boolean" || !requiredStrength) {
      return result(false, "inconclusive", "INSUFFICIENT_OBSERVATION_STRENGTH",
        "Observer descriptor or risk class is invalid.");
    }
    if (observation.observerId !== descriptor.id ||
      !["confirmed", "contradicted", "unknown", "inconclusive", "stale"].includes(observation.status)) {
      return result(false, "unknown", "OBSERVATION_UNKNOWN", "Observation has invalid provenance or status.");
    }
    if (!sameSubject(observation.subject, requirement.subject)) {
      return result(false, "unknown", "OBSERVATION_SUBJECT_MISMATCH", "Observation belongs to another subject.");
    }
    if (observation.expectedPostconditionHash !== postconditionHash(requirement.expectedPostcondition) ||
      observation.expectedPostconditionHash !== postconditionHash(observation.expectedPostcondition)) {
      return result(false, "unknown", "POSTCONDITION_MISMATCH", "Observation belongs to another postcondition.");
    }
    if (observation.status === "stale") {
      return result(false, "stale", "OBSERVATION_STALE", "Observer explicitly marked evidence stale.");
    }
    const age = this.clock.now() - observation.observedAt;
    if (!Number.isFinite(requirement.maxAgeMs) || requirement.maxAgeMs < 0 || age < 0 ||
      age > requirement.maxAgeMs) {
      return result(false, "stale", "OBSERVATION_TOO_OLD", "Evidence is outside the allowed age window.");
    }
    if (observation.status === "unknown") {
      return result(false, "unknown", "OBSERVATION_UNKNOWN", "Reality could not be established.");
    }
    if (observation.status === "inconclusive") {
      return result(false, "inconclusive", "OBSERVATION_INCONCLUSIVE", "Evidence does not decide the postcondition.");
    }
    for (const id of observation.subject.resourceIds) {
      const captured = observation.observedResourceGenerations[id];
      if (captured === undefined) {
        if (requirement.requireGenerationBinding) {
          return result(false, "unknown", "RESOURCE_GENERATION_UNKNOWN", "Resource generation was not captured.");
        }
        continue;
      }
      if (!this.resources) {
        return result(false, "unknown", "RESOURCE_GENERATION_UNKNOWN", "Current resource generation is unavailable.");
      }
      const current = this.resources.get(id);
      if (!current || current.generation !== captured) {
        return result(false, "stale", "RESOURCE_GENERATION_CHANGED", "Resource generation changed after observation.");
      }
    }
    if (!observation.evidence.length || strengthRank[actualStrength] < strengthRank[requiredStrength]) {
      return result(false, "inconclusive", "INSUFFICIENT_OBSERVATION_STRENGTH",
        "Evidence is too weak for this risk class.");
    }
    if (observation.status === "contradicted") {
      return result(true, "contradicted", "OBSERVATION_CONTRADICTED", "Accepted evidence contradicts the postcondition.");
    }
    return result(true, "confirmed", "OBSERVATION_CONFIRMED", "Accepted evidence confirms the postcondition.");
  }

  evaluateObservations(
    entries: readonly { observation: Observation; descriptor: ObserverDescriptor }[],
    requirement: ObservationRequirement
  ): ObservationEvaluation {
    const evaluated = entries.map(entry => this.evaluate(entry.observation, entry.descriptor, requirement));
    const confirmed = evaluated.find(item => item.accepted && item.effectiveStatus === "confirmed");
    const contradicted = evaluated.find(item => item.accepted && item.effectiveStatus === "contradicted");
    if (confirmed && contradicted) {
      return { accepted: false, effectiveStatus: "inconclusive", reasonCode: "CONFLICTING_EVIDENCE",
        explanation: "Accepted observations conflict." };
    }
    if (contradicted) return contradicted;
    if (confirmed) return confirmed;
    return evaluated.at(-1) ?? { accepted: false, effectiveStatus: "unknown",
      reasonCode: "OBSERVATION_UNKNOWN", explanation: "No observations were supplied." };
  }
}
