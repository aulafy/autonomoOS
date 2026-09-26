import { InMemoryBudgetLedger } from "@agent-world/budgets";
import { ActionRegistry as CompositionActionRegistry, CandidateCompiler,
  CompositionEngine, defaultCompositionRules, FactCompiler,
  InMemoryApprovalStore, InMemoryHistoryStore, type CompositionRule } from "@agent-world/composition-policy";
import { ContractValidator, InMemoryContractStore } from "@agent-world/contracts";
import { EffectCoordinator, InMemoryEffectEventSink, InMemoryEffectStore } from "@agent-world/effects";
import { defaultFlowRules, FlowEngine, InMemoryDataFlowStore,
  InMemoryReleaseApprovalStore, InMemoryTaskWorkingSetStore, SinkRegistry } from "@agent-world/information-flow";
import { AuthorityLeaseService, AuthorityLeaseValidator, InMemoryAuthorityLeaseStore,
  InMemoryResourceLeaseStore, LeaseCommitGate } from "@agent-world/leases";
import { InMemoryObservationStore, InMemoryObserverRegistry, ObservationPolicy,
  ObservationService, postconditionHash, type ObservationStatus } from "@agent-world/observation";
import { InMemoryReconciliationQueue, ReconciliationService } from "@agent-world/reconciliation";
import { InMemoryResourceRegistry, mintResourceId } from "@agent-world/resources";
import { SupervisorEngine, type RuntimeSnapshot } from "@agent-world/supervision";
import { ExecutorRegistry, GovernedActionRegistry, GovernedActionRunner,
  InMemoryControlEventSink, LiveCommitGate, type GovernedActionRequest } from "../src/index.js";

export const placeId = mintResourceId("world_place", "demo-office/meeting-room");
export const sinkId = mintResourceId("sink_email", "demo/outbound");

export async function fixture(options: { requiresFlow?: boolean;
  compositionRule?: CompositionRule } = {}) {
  let now = 100;
  let sequence = 0;
  let executorCalls = 0;
  let observationStatus: ObservationStatus = "confirmed";
  let observerThrows = false;
  const clock = { now: () => now };
  const resources = new InMemoryResourceRegistry();
  const resourceInput = { id: placeId, kind: "world_place" as const,
    displayName: "Meeting Room", aliases: [], parentId: null, dataLabel: null,
    exclusivity: "exclusive" as const, sink: null, source: "host" as const };
  resources.register(resourceInput);
  resources.register({ id: sinkId, kind: "sink_email", displayName: "Outbound",
    aliases: [], parentId: null, dataLabel: null, exclusivity: "shared", source: "host",
    sink: { external: true, trustClass: "external", allowedSensitivity: ["public"] } });
  const contracts = new InMemoryContractStore();
  await contracts.create({ id: "contract-1", ownerPrincipalId: "astra", taskId: "task-1",
    objective: "move to meeting room", acceptanceCriteria: ["agent at meeting room"],
    forbiddenEffects: [], allowedResourceIds: [placeId, sinkId], maxRisk: "R3",
    privacyClass: "local_only", budgetId: "budget-1", authorityLeaseId: "authority-1",
    createdAt: 100, version: 1, status: "active", metadata: {} });
  const grant = { id: "grant-1", version: 1, subjectPrincipalId: "astra",
    resourceIds: [placeId, sinkId], actions: ["goto"], issuedAt: 90, expiresAt: 200,
    revokedAt: undefined as number | undefined };
  const authoritySource = { getGrant: (id: string) => id === "grant-1" ? structuredClone(grant) : null };
  const authorityStore = new InMemoryAuthorityLeaseStore();
  const authorityService = new AuthorityLeaseService(authoritySource, authorityStore, clock);
  authorityService.issue({ id: "authority-1", grantId: "grant-1", subjectPrincipalId: "astra",
    taskId: "task-1", resourceIds: [placeId, sinkId], actions: ["goto"],
    notBefore: 100, expiresAt: 200 });
  const resourceLeases = new InMemoryResourceLeaseStore(clock);
  const resourceLease = resourceLeases.acquire({ id: "resource-lease-1", resourceId: placeId,
    holderPrincipalId: "astra", taskId: "task-1", expiresAt: 200 });
  const leaseGate = new LeaseCommitGate(
    new AuthorityLeaseValidator(authoritySource, authorityStore, clock), resourceLeases, clock);
  const budgets = new InMemoryBudgetLedger(clock);
  budgets.createBudget({ id: "budget-1", ownerPrincipalId: "astra", taskId: "task-1",
    ceiling: { actions: "10" } });
  const observations = new InMemoryObservationStore();
  const observers = new InMemoryObserverRegistry();
  observers.register({ descriptor: { id: "world-observer", implementation: "fixture",
    sourceType: "world", independence: "independent_local", strength: "strong",
    authenticated: true, metadata: {} },
    observe: async request => {
      if (observerThrows) throw new Error("observer failed");
      return { id: `obs-${++sequence}`, observerId: "world-observer", source: "world",
        status: observationStatus, observedAt: now, subject: structuredClone(request.subject),
        expectedPostcondition: structuredClone(request.expectedPostcondition),
        expectedPostconditionHash: postconditionHash(request.expectedPostcondition),
        observedResourceGenerations: {},
        evidence: observationStatus === "confirmed" || observationStatus === "contradicted"
          ? [{ kind: "event" as const, reference: `world-${sequence}`, metadata: {} }] : [],
        reason: "fixture observation", metadata: {} };
    } });
  const policy = new ObservationPolicy(clock);
  const observationService = new ObservationService(observers, observations, policy, clock);
  const effects = new InMemoryEffectStore();
  const effectCoordinator = new EffectCoordinator(effects, observations, observers, policy,
    new InMemoryEffectEventSink(), clock);
  const compositionActions = new CompositionActionRegistry();
  compositionActions.register({ actionType: "goto", actionClass: "safe" });
  const history = new InMemoryHistoryStore();
  const composition = new CompositionEngine(new CandidateCompiler(compositionActions, resources),
    history, new InMemoryApprovalStore(),
    [...defaultCompositionRules(), ...(options.compositionRule ? [options.compositionRule] : [])], clock);
  const objects = new InMemoryDataFlowStore();
  const workingSet = new InMemoryTaskWorkingSetStore(objects);
  const sinks = new SinkRegistry(resources);
  sinks.register({ id: sinkId, kind: "email", trust: "external", hostControlled: true, metadata: {} });
  const releaseApprovals = new InMemoryReleaseApprovalStore();
  const flow = new FlowEngine(objects, workingSet, sinks,
    releaseApprovals, defaultFlowRules(), () => now);
  const facts = new FactCompiler(history, effects, observations, observers, policy,
    compositionActions, {});
  const reconciliation = new ReconciliationService(effects, new InMemoryReconciliationQueue(),
    observations, observers, policy, [], () => now);
  const supervisor = new SupervisorEngine({ stalledTaskMs: 100, preparingMs: 100,
    dispatchingMs: 100, maxUnknownBacklog: 10, highUnknownRate: 1 });
  const snapshot = (): RuntimeSnapshot => ({ now, tasks: [], authorityLeases: [],
    resourceLeases: [], budgets: [], effects: [], reconciliations: [], components: [],
    quarantines: [], emergencyStop: { active: false }, policyAvailable: true,
    eventStoreAvailable: true, unknownRateByExecutor: {} });
  const state = { runnable: true, snapshot };
  const gate = new LiveCommitGate({ contracts, contractValidator: new ContractValidator(),
    resources, leases: leaseGate, resourceLeases, budgets, effects, composition, flow,
    supervisor, snapshot: () => state.snapshot(), tasks: { isRunnable: () => state.runnable },
    now: () => now });
  const actions = new GovernedActionRegistry();
  actions.register({ action: "goto", executorId: "world-executor", observerId: "world-observer",
    risk: "R1", resourceKinds: ["world_place"], requiresResourceLease: true,
    requiresFlow: options.requiresFlow ?? false, budgetAmount: { actions: "1" },
    reservationTtlMs: 20,
    expectedPostcondition: resourceId => ({ kind: "agent_position", resourceIds: [resourceId],
      predicate: "position", expected: { agent: "astra", at: resourceId }, metadata: {} }) });
  const executors = new ExecutorRegistry();
  executors.register({ id: "world-executor", dispatch: async () => {
    executorCalls++;
    return { kind: "reported_success", metadata: {} };
  } });
  const events = new InMemoryControlEventSink();
  const ids = { next: (kind: string) => `${kind}-${++sequence}` };
  const runner = new GovernedActionRunner({ actions, executors, observers, contracts,
    resources, budgets, effects, coordinator: effectCoordinator, observationService,
    reconciliation, facts, gate, events, ids, now: () => now, observationMaxAgeMs: 100 });
  const request: GovernedActionRequest = { taskId: "task-1", principalId: "astra",
    contractId: "contract-1", intent: { id: "intent-1", actorId: "astra", action: "goto",
      targetId: "Meeting Room", parameters: {}, provenance: { source: "model" } },
    authorityLeaseId: "authority-1", resourceLeaseId: resourceLease.id,
    fencingToken: resourceLease.fencingToken, correlationId: "task-1" };
  if (options.requiresFlow) {
    objects.addSource({ id: "public-object", taskId: "task-1", label: {
      confidentiality: "public", categories: [], jurisdictions: [], ownerPrincipalIds: [],
      releasable: true, metadata: {} }, origin: "human", createdAt: 100, metadata: {} });
    workingSet.add("task-1", "public-object", 0);
    request.flowObjectIds = ["public-object"];
    request.flowSinkId = sinkId;
  }
  return { runner, gate, request, effects, budgets, resourceLeases, resources,
    contracts, observations, observers, policy,
    resourceInput, grant, authorityStore, history, workingSet, objects, flow,
    releaseApprovals, events,
    executors, actions, state, placeId, snapshot,
    setNow: (value: number) => { now = value; },
    setObservationStatus: (value: ObservationStatus) => { observationStatus = value; },
    setObserverThrows: (value: boolean) => { observerThrows = value; },
    executorCalls: () => executorCalls };
}
