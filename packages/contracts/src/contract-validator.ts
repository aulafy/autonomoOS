import type { ActionIntent } from "@agent-world/protocol";
import { isCanonicalResourceId } from "@agent-world/resources";
import type {
  ContractPrivacy,
  ContractRisk,
  SessionContract
} from "./contract.js";

const riskRank: Record<ContractRisk, number> = {
  R0: 0,
  R1: 1,
  R2: 2,
  R3: 3,
  R4: 4,
  R5: 5
};

const privacyRank: Record<ContractPrivacy, number> = {
  local_only: 0,
  trusted_remote: 1,
  cloud_allowed: 2,
  public: 3
};

export interface ContractValidationResult {
  allowed: boolean;
  reason: string;
}

export interface ReplanContractView {
  objective: string;
  acceptanceCriteria: string[];
  forbiddenEffects?: string[];
  allowedResourceIds?: string[];
  maxRisk?: ContractRisk;
  privacyClass?: ContractPrivacy;
  deadlineAt?: number;
}

function sameStrings(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function isSuperset(candidate: string[], required: string[]): boolean {
  const values = new Set(candidate);
  return required.every(value => values.has(value));
}

function isSubset(candidate: string[], allowed: string[]): boolean {
  const allowedSet = new Set(allowed);
  return candidate.every(value => allowedSet.has(value));
}

export class ContractValidator {
  validateIntent(
    contract: SessionContract,
    intent: ActionIntent,
    actionRisk: ContractRisk,
    now: number
  ): ContractValidationResult {
    if (contract.status !== "active") {
      return {
        allowed: false,
        reason: "Session contract is not active."
      };
    }

    if (contract.deadlineAt !== undefined && now > contract.deadlineAt) {
      return {
        allowed: false,
        reason: "Session contract deadline has expired."
      };
    }

    if (riskRank[actionRisk] > riskRank[contract.maxRisk]) {
      return {
        allowed: false,
        reason: `Action risk ${actionRisk} exceeds contract maxRisk ${contract.maxRisk}.`
      };
    }

    if (
      intent.targetId &&
      contract.allowedResourceIds.length > 0 &&
      (!isCanonicalResourceId(intent.targetId) ||
        !contract.allowedResourceIds.includes(intent.targetId))
    ) {
      return {
        allowed: false,
        reason: `Target '${intent.targetId}' is outside contract resource scope.`
      };
    }

    if (contract.forbiddenEffects.includes(intent.action)) {
      return {
        allowed: false,
        reason: `Action '${intent.action}' is forbidden by the session contract.`
      };
    }

    return {
      allowed: true,
      reason: "Intent satisfies the session contract."
    };
  }

  validateReplan(
    contract: SessionContract,
    proposed: ReplanContractView
  ): ContractValidationResult {
    if (proposed.objective.trim() !== contract.objective.trim()) {
      return {
        allowed: false,
        reason: "Replanning may not change the immutable contract objective."
      };
    }

    if (!sameStrings(proposed.acceptanceCriteria, contract.acceptanceCriteria)) {
      return {
        allowed: false,
        reason: "Replanning may not change contract acceptance criteria."
      };
    }

    if (
      proposed.forbiddenEffects !== undefined &&
      !isSuperset(proposed.forbiddenEffects, contract.forbiddenEffects)
    ) {
      return {
        allowed: false,
        reason: "Replanning may not remove a forbidden effect."
      };
    }

    if (
      proposed.allowedResourceIds !== undefined &&
      contract.allowedResourceIds.length > 0 &&
      !isSubset(proposed.allowedResourceIds, contract.allowedResourceIds)
    ) {
      return {
        allowed: false,
        reason: "Replanning may not broaden the contract resource scope."
      };
    }

    if (
      proposed.maxRisk !== undefined &&
      riskRank[proposed.maxRisk] > riskRank[contract.maxRisk]
    ) {
      return {
        allowed: false,
        reason: "Replanning may not increase the contract risk ceiling."
      };
    }

    if (
      proposed.privacyClass !== undefined &&
      privacyRank[proposed.privacyClass] > privacyRank[contract.privacyClass]
    ) {
      return {
        allowed: false,
        reason: "Replanning may not relax the contract privacy class."
      };
    }

    if (
      proposed.deadlineAt !== undefined &&
      contract.deadlineAt !== undefined &&
      proposed.deadlineAt > contract.deadlineAt
    ) {
      return {
        allowed: false,
        reason: "Replanning may not extend the contract deadline."
      };
    }

    return {
      allowed: true,
      reason: "Replan preserves the active session contract."
    };
  }
}
