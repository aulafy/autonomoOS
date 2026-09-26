import type { ContractStore } from "@agent-world/contracts";
import type { EffectStore } from "@agent-world/effects";
import { ObservationPolicy, type ObservationStore, type ObserverRegistry } from "@agent-world/observation";

/** A host-owned mapping from contract criterion text to the effect that proves it. */
export interface TaskAcceptanceEvidence {
  criterion: string;
  effectId: string;
  riskClass: "R0" | "R1" | "R2" | "R3" | "R4" | "R5";
}

export interface TaskCompletionRequest {
  taskId: string;
  contractId: string;
  requiredEffectIds: readonly string[];
  acceptanceEvidence: readonly TaskAcceptanceEvidence[];
  maxObservationAgeMs: number;
  pendingApprovalCount: number;
}

export interface TaskCompletionDecision {
  complete: boolean;
  reasonCode: string;
}

export class TaskCompletionEvaluator {
  constructor(private readonly contracts: ContractStore,
    private readonly effects: EffectStore,
    private readonly observations: ObservationStore,
    private readonly observers: ObserverRegistry,
    private readonly policy: ObservationPolicy) {}

  async evaluate(request: TaskCompletionRequest): Promise<TaskCompletionDecision> {
    const fail = (reasonCode: string): TaskCompletionDecision => ({ complete: false, reasonCode });
    const contract = await this.contracts.get(request.contractId);
    if (!contract || contract.taskId !== request.taskId || contract.status !== "active") {
      return fail("CONTRACT_NOT_ACTIVE");
    }
    if (request.pendingApprovalCount !== 0) return fail("APPROVAL_PENDING");
    const taskEffects = this.effects.listByTask(request.taskId);
    if (taskEffects.some(effect => ["preparing", "prepared", "dispatching", "unknown"]
      .includes(effect.status))) return fail("UNSETTLED_EFFECT");
    const required = new Set(request.requiredEffectIds);
    if (required.size !== request.requiredEffectIds.length) return fail("DUPLICATE_REQUIRED_EFFECT");
    for (const id of required) {
      const effect = this.effects.get(id);
      if (!effect || effect.taskId !== request.taskId ||
        effect.sessionContractId !== request.contractId || effect.status !== "committed") {
        return fail("REQUIRED_EFFECT_NOT_COMMITTED");
      }
    }
    const criteria = new Set(contract.acceptanceCriteria);
    if (criteria.size !== request.acceptanceEvidence.length ||
      request.acceptanceEvidence.some(entry => !criteria.has(entry.criterion) ||
        !required.has(entry.effectId)) ||
      new Set(request.acceptanceEvidence.map(entry => entry.criterion)).size !== criteria.size) {
      return fail("ACCEPTANCE_CRITERIA_UNMAPPED");
    }
    for (const entry of request.acceptanceEvidence) {
      const effect = this.effects.get(entry.effectId)!;
      const requirement = { subject: { taskId: effect.taskId, intentId: effect.intentId,
        executionId: effect.executionId, effectId: effect.id, resourceIds: effect.resourceIds },
        expectedPostcondition: effect.expectedPostcondition, riskClass: entry.riskClass,
        maxAgeMs: request.maxObservationAgeMs };
      const evaluations = this.observations.listByEffect(effect.id).flatMap(observation => {
        const observer = this.observers.get(observation.observerId);
        return observer ? [{ observation, descriptor: observer.descriptor }] : [];
      });
      const decision = this.policy.evaluateObservations(evaluations, requirement);
      if (!decision.accepted || decision.effectiveStatus !== "confirmed") {
        return fail("ACCEPTANCE_NOT_OBSERVED");
      }
    }
    return { complete: true, reasonCode: "TASK_ACCEPTED" };
  }
}
