import { InMemoryBudgetLedger } from "@agent-world/budgets";
import { InMemoryApprovalStore, InMemoryHistoryStore } from "@agent-world/composition-policy";
import { InMemoryContractStore } from "@agent-world/contracts";
import { InMemoryEffectEventSink, InMemoryEffectStore } from "@agent-world/effects";
import { InMemoryDataFlowStore, InMemoryReleaseApprovalStore,
  InMemoryTaskWorkingSetStore, SinkRegistry } from "@agent-world/information-flow";
import { InMemoryAuthorityLeaseStore, InMemoryResourceLeaseStore } from "@agent-world/leases";
import { InMemoryObservationStore } from "@agent-world/observation";
import { InMemoryReconciliationQueue } from "@agent-world/reconciliation";
import { InMemoryResourceRegistry } from "@agent-world/resources";
import { InMemoryEmergencyStopStore, InMemoryQuarantineStore } from "@agent-world/supervision";
import { InMemoryAuthorityGrantStore } from "./authority-grants.js";
import type { JournalKernel } from "./journal-kernel.js";
import { InMemoryDurableTaskStore } from "./task-store.js";

/** One SQLite command log backs all registered C1–C12 control state. */
export function createDurableDomainStores(kernel: JournalKernel) {
  const clock = kernel.clock;
  const resources = kernel.register("resources",
    () => new InMemoryResourceRegistry(clock.now), ["register", "update"]);
  const grants = kernel.register("authorityGrants",
    () => new InMemoryAuthorityGrantStore(), ["create", "revoke"]);
  const contracts = kernel.register("contracts",
    () => new InMemoryContractStore(), ["create", "markStatus"]);
  const authorityLeases = kernel.register("authorityLeases",
    () => new InMemoryAuthorityLeaseStore(), ["create", "setStatus"]);
  const resourceLeases = kernel.register("resourceLeases",
    () => new InMemoryResourceLeaseStore(clock), ["acquire", "renew", "release", "revoke"]);
  const budgets = kernel.register("budgets",
    () => new InMemoryBudgetLedger(clock), ["createBudget", "createChildBudget",
      "freezeBudget", "unfreezeBudget", "closeBudget", "reserve", "commitReservation",
      "releaseReservation", "expireReservation"]);
  const observations = kernel.register("observations",
    () => new InMemoryObservationStore(), ["append"]);
  const effects = kernel.register("effects",
    () => new InMemoryEffectStore(), ["create", "update"]);
  const effectEvents = kernel.register("effectEvents",
    () => new InMemoryEffectEventSink(), ["append"]);
  const reconciliations = kernel.register("reconciliations",
    () => new InMemoryReconciliationQueue(), ["enqueue", "update", "appendDecision"]);
  const history = kernel.register("compositionHistory",
    () => new InMemoryHistoryStore(), ["append"]);
  const compositionApprovals = kernel.register("compositionApprovals",
    () => new InMemoryApprovalStore(), ["append"]);
  const dataObjects = kernel.register("dataObjects",
    () => new InMemoryDataFlowStore(), ["addSource", "derive"]);
  const workingSets = kernel.register("workingSets",
    () => new InMemoryTaskWorkingSetStore(dataObjects), ["add"]);
  const sinks = kernel.register("sinks",
    () => new SinkRegistry(resources), ["register"]);
  const releaseApprovals = kernel.register("releaseApprovals",
    () => new InMemoryReleaseApprovalStore(), ["append"]);
  const emergencyStop = kernel.register("emergencyStop",
    () => new InMemoryEmergencyStopStore(), ["activate", "clearByOperator"]);
  const quarantines = kernel.register("quarantines",
    () => new InMemoryQuarantineStore(), ["add"]);
  const tasks = kernel.register("tasks",
    () => new InMemoryDurableTaskStore(), ["create", "addRequiredEffect", "setStatus"]);
  return { resources, grants, contracts, authorityLeases, resourceLeases,
    budgets, observations, effects, effectEvents, reconciliations, history,
    compositionApprovals, dataObjects, workingSets, sinks, releaseApprovals,
    emergencyStop, quarantines, tasks };
}
