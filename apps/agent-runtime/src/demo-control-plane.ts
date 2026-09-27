import { createHash } from "node:crypto";
import { InMemoryBudgetLedger } from "@agent-world/budgets";
import { ActionRegistry as CompositionActions, CandidateCompiler, CompositionEngine,
  defaultCompositionRules, FactCompiler, InMemoryApprovalStore,
  InMemoryHistoryStore } from "@agent-world/composition-policy";
import { GovernedActionRegistry, ExecutorRegistry, GovernedActionRunner,
  LiveCommitGate, TaskCompletionEvaluator, type TaskAcceptanceEvidence,
  type GovernedResult } from "@agent-world/control-plane";
import { ContractValidator, InMemoryContractStore } from "@agent-world/contracts";
import type { ContractRisk } from "@agent-world/contracts";
import { EffectCoordinator, InMemoryEffectEventSink, InMemoryEffectStore } from "@agent-world/effects";
import { expectedBytes, FilesystemObserver, FilesystemReadExecutor,
  FilesystemReconciler, FilesystemWriteExecutor, validateLogicalPath,
  type FilesystemWorkspace } from
  "@agent-world/filesystem";
import { defaultFlowRules, FlowEngine, InMemoryDataFlowStore,
  InMemoryReleaseApprovalStore, InMemoryTaskWorkingSetStore, SinkRegistry } from "@agent-world/information-flow";
import type { DataLabel } from "@agent-world/information-flow";
import { AuthorityLeaseService, AuthorityLeaseValidator, InMemoryAuthorityLeaseStore,
  InMemoryResourceLeaseStore, LeaseCommitGate, type AuthorityGrantView } from "@agent-world/leases";
import { InMemoryObservationStore, InMemoryObserverRegistry, ObservationPolicy,
  ObservationService, postconditionHash } from "@agent-world/observation";
import type { ActionIntent, RuntimeEvent } from "@agent-world/protocol";
import { InMemoryReconciliationQueue, ReconciliationService } from "@agent-world/reconciliation";
import { RecoveryManager, RuntimeModeController } from "@agent-world/recovery";
import { createDemoResources, InMemoryResourceRegistry, mintResourceId,
  ResourceResolver } from "@agent-world/resources";
import type { ResourceId } from "@agent-world/resources";
import { InMemoryEmergencyStopStore, InMemoryQuarantineStore, SupervisorEngine,
  type RuntimeSnapshot } from "@agent-world/supervision";
import type { WorldRuntime } from "@agent-world/world-core";
import type { JournalKernel, createDurableDomainStores } from "@agent-world/runtime-store-sqlite";

type Emit = (event: RuntimeEvent) => void;

/** Host-owned demo authority for M5's in-process world. No model may mint grants. */
export function createDemoControlPlane(world: WorldRuntime, emit: Emit,
  durable?: { kernel: JournalKernel; stores: ReturnType<typeof createDurableDomainStores>;
    beforeExecutorDispatch?(): void; beforeCommitGate?(): void;
    beforePreparedDispatch?(): void; afterExecutorResponse?(): void;
    afterObservationPersisted?(): void; afterFilesystemMutation?(): void;
    filesystem?: FilesystemWorkspace }) {
  const clock = durable?.kernel.clock ?? { now: () => Date.now() };
  const filesystem = durable?.filesystem;
  const stores = durable?.stores;
  const resources = stores?.resources ?? new InMemoryResourceRegistry();
  if (!resources.list().length) createDemoResources(resources);
  const slowToolId = mintResourceId("tool", "demo.slow");
  if (!resources.get(slowToolId)) resources.register({ id: slowToolId, kind: "tool", displayName: "Demo Slow Tool",
    aliases: ["demo.slow"], parentId: null, dataLabel: null, exclusivity: "shared",
    sink: null, source: "host" });
  const safeResources = resources.list().filter(item => ["world_place", "agent", "tool", "file"]
    .includes(item.kind)).map(item => item.id);
  const grants = stores?.grants ?? new Map<string, AuthorityGrantView>();
  const authoritySource = stores?.grants ?? { getGrant: (id: string) =>
    (grants as Map<string, AuthorityGrantView>).get(id) ?? null };
  const authorityStore = stores?.authorityLeases ?? new InMemoryAuthorityLeaseStore();
  const authorityService = new AuthorityLeaseService(authoritySource, authorityStore, clock);
  const resourceLeases = stores?.resourceLeases ?? new InMemoryResourceLeaseStore(clock);
  const leaseGate = new LeaseCommitGate(new AuthorityLeaseValidator(
    authoritySource, authorityStore, clock), resourceLeases, clock);
  const contracts = stores?.contracts ?? new InMemoryContractStore();
  const budgets = stores?.budgets ?? new InMemoryBudgetLedger(clock);
  const observations = stores?.observations ?? new InMemoryObservationStore();
  const observers = new InMemoryObserverRegistry();
  const observationPolicy = new ObservationPolicy(clock, resources);
  const observationService = new ObservationService(observers, observations,
    observationPolicy, clock);
  const effects = stores?.effects ?? new InMemoryEffectStore();
  const coordinator = new EffectCoordinator(effects, observations, observers,
    observationPolicy, stores?.effectEvents ?? new InMemoryEffectEventSink(), clock);
  const compositionActions = new CompositionActions();
  for (const actionType of ["goto", "say", "use_tool"]) {
    compositionActions.register({ actionType, actionClass: "safe" });
  }
  if (filesystem) {
    compositionActions.register({ actionType: "file.read", actionClass: "sensitive_read" });
    compositionActions.register({ actionType: "file.write", actionClass: "external_send" });
  }
  const history = stores?.history ?? new InMemoryHistoryStore();
  const composition = new CompositionEngine(new CandidateCompiler(compositionActions, resources),
    history, stores?.compositionApprovals ?? new InMemoryApprovalStore(), defaultCompositionRules(), clock);
  const objects = stores?.dataObjects ?? new InMemoryDataFlowStore();
  const workingSets = stores?.workingSets ?? new InMemoryTaskWorkingSetStore(objects);
  const sinkRegistry = stores?.sinks ?? new SinkRegistry(resources);
  const inferenceSinkId = mintResourceId("tool", "local.inference");
  if (!resources.has(inferenceSinkId)) resources.register({ id: inferenceSinkId,
    kind: "tool", displayName: "Local inference", aliases: [], parentId: null,
    dataLabel: null, exclusivity: "shared", sink: { external: false,
      trustClass: "local", allowedSensitivity: ["public", "internal",
        "confidential", "restricted", "secret"] }, source: "host" });
  if (!sinkRegistry.get(inferenceSinkId)) sinkRegistry.register({ id: inferenceSinkId,
    kind: "model_provider", trust: "local", hostControlled: true, metadata: {} });
  if (filesystem) for (const file of resources.listByKind("file")) {
    if (!sinkRegistry.get(file.id)) sinkRegistry.register({ id: file.id, kind: "file",
      trust: file.sink?.trustClass ?? "local", hostControlled: true, metadata: {} });
  }
  const flow = new FlowEngine(objects, workingSets,
    sinkRegistry, stores?.releaseApprovals ??
      new InMemoryReleaseApprovalStore(), defaultFlowRules(), clock.now);
  const facts = new FactCompiler(history, effects, observations, observers,
    observationPolicy, compositionActions, {});
  const reconciliationQueue = stores?.reconciliations ?? new InMemoryReconciliationQueue();
  const filesystemObserver = filesystem ? new FilesystemObserver(filesystem, resources, clock.now) : null;
  const reconciliation = new ReconciliationService(effects, reconciliationQueue,
    observations, observers, observationPolicy,
    filesystemObserver ? [new FilesystemReconciler(filesystemObserver)] : [], clock.now);
  const supervisor = new SupervisorEngine({ stalledTaskMs: 60000, preparingMs: 60000,
    dispatchingMs: 60000, maxUnknownBacklog: 10, highUnknownRate: 1 });
  const emergencyStop = stores?.emergencyStop ?? new InMemoryEmergencyStopStore();
  const quarantines = stores?.quarantines ?? new InMemoryQuarantineStore();
  const runtimeMode = new RuntimeModeController();
  const stoppedTasks = new Set<string>();
  const snapshot = (): RuntimeSnapshot => ({ now: clock.now(), tasks: [], authorityLeases: [],
    resourceLeases: [], budgets: [], effects: effects.list().map(effect => ({
      id: effect.id, taskId: effect.taskId, executorId: effect.executorId,
      status: effect.status, createdAt: effect.createdAt, preparedAt: effect.preparedAt,
      dispatchStartedAt: effect.dispatchStartedAt, observationIds: effect.observationIds,
      required: true })), reconciliations: reconciliationQueue.list().map(job => ({
        id: job.id, effectId: job.effectId, status: job.status,
        nextAttemptAt: job.nextAttemptAt, attempts: job.attempts,
        maxAttempts: job.maxAttempts })), components: [],
    quarantines: quarantines.list(), emergencyStop: emergencyStop.get(), policyAvailable: true,
    eventStoreAvailable: durable?.kernel.isHealthy() ?? true, unknownRateByExecutor: {} });
  const gate = new LiveCommitGate({ contracts, contractValidator: new ContractValidator(),
    resources, leases: leaseGate, resourceLeases, budgets, effects, composition, flow,
    supervisor, snapshot, tasks: { isRunnable: id => !stoppedTasks.has(id) &&
      (stores?.tasks.isRunnable(id) ?? true) && (durable?.kernel.isHealthy() ?? true) },
    runtimeMode, now: clock.now });
  const actions = new GovernedActionRegistry();
  actions.register({ action: "goto", executorId: "demo-world", observerId: "demo-world-observer",
    risk: "R1", resourceKinds: ["world_place"], requiresResourceLease: true,
    requiresFlow: false, budgetAmount: { actions: "1" }, reservationTtlMs: 30000,
    expectedPostcondition: (id, intent) => ({ kind: "demo_world_position",
      resourceIds: [id], predicate: "position", expected: { actorId: intent.actorId,
        targetId: id }, metadata: {} }) });
  actions.register({ action: "say", executorId: "demo-world", observerId: "demo-world-observer",
    risk: "R1", resourceKinds: ["agent"], requiresResourceLease: false,
    requiresFlow: false, budgetAmount: { actions: "1" }, reservationTtlMs: 30000,
    expectedPostcondition: (id, intent) => ({ kind: "demo_world_speech",
      resourceIds: [id], predicate: "equals", expected: { text: intent.parameters?.text },
      metadata: {} }) });
  actions.register({ action: "use_tool", executorId: "demo-slow-tool", observerId: "demo-world-observer",
    risk: "R1", resourceKinds: ["tool"], requiresResourceLease: false,
    requiresFlow: false, budgetAmount: { actions: "1" }, reservationTtlMs: 30000,
    expectedPostcondition: id => ({ kind: "demo_slow_tool", resourceIds: [id],
      predicate: "state", expected: { finished: true }, metadata: {} }) });
  if (filesystem) {
    actions.register({ action: "file.read", executorId: "filesystem-read",
      observerId: "filesystem-observer", risk: "R1", resourceKinds: ["file"],
      requiresResourceLease: false, requiresFlow: false,
      budgetAmount: { actions: "1" }, reservationTtlMs: 30000,
      expectedPostcondition: id => ({ kind: "filesystem_read", resourceIds: [id],
        predicate: "exists", expected: { exists: true }, metadata: {} }) });
    actions.register({ action: "file.write", executorId: "filesystem-write",
      observerId: "filesystem-observer", risk: "R2", resourceKinds: ["file"],
      requiresResourceLease: true, requiresFlow: true, strictDecisionVersions: true,
      budgetAmount: { actions: "1" },
      budgetForIntent: intent => ({ actions: "1",
        bytes: String(expectedBytes(intent.parameters ?? {}).bytes.length) }),
      reservationTtlMs: 30000,
      expectedPostcondition: (id, intent) => {
        const expected = expectedBytes(intent.parameters ?? {});
        return { kind: "filesystem_write", resourceIds: [id], predicate: "hash",
          expected: { sha256: expected.sha256, byteLength: expected.bytes.length },
          metadata: { mode: expected.mode } };
      } });
  }
  const executed = new Map<string, { type: string; actorId: string; entityId?: string;
    payload: Record<string, unknown> }>();
  const executors = new ExecutorRegistry();
  const filesystemRead = filesystem ? new FilesystemReadExecutor(filesystem) : null;
  if (filesystem) {
    executors.register(new FilesystemWriteExecutor(filesystem,
      durable?.afterFilesystemMutation));
    executors.register(filesystemRead!);
    observers.register(filesystemObserver!);
  }
  executors.register({ id: "demo-world", dispatch: async context => {
    const effect = effects.get(context.effectId)!;
    const target = resources.get(context.resourceIds[0]!)!;
    const legacyTarget = String(target.metadata.legacyWorldEntityId ?? "astra");
    const worldEvent = world.execute({ id: effect.intentId, actorId: "astra",
      action: effect.action as "goto" | "say", targetId: legacyTarget,
      parameters: context.parameters, provenance: { source: "rule" } });
    executed.set(effect.id, { type: worldEvent.type, actorId: worldEvent.actorId ?? "astra",
      entityId: worldEvent.entityId, payload: worldEvent.payload });
    emit({ id: worldEvent.id, timestamp: worldEvent.timestamp,
      type: worldEvent.type as RuntimeEvent["type"], taskId: effect.taskId,
      intentId: effect.intentId, executionId: effect.executionId,
      actorId: worldEvent.actorId, entityId: worldEvent.entityId,
      payload: worldEvent.payload });
    return { kind: "reported_success", metadata: {} };
  } });
  executors.register({ id: "demo-slow-tool", dispatch: async (context, signal) => {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) { reject(new Error("REVOKED")); return; }
      const timer = setTimeout(resolve, 5000);
      signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("REVOKED")); },
        { once: true });
    });
    executed.set(context.effectId, { type: "demo.slow.finished", actorId: "astra", payload: {} });
    return { kind: "reported_success", metadata: {} };
  } });
  observers.register({ descriptor: { id: "demo-world-observer", implementation: "M5 world inspection",
    sourceType: "world", independence: "same_process", strength: "moderate",
    authenticated: true, metadata: {} }, observe: async request => {
    const effect = effects.get(request.subject.effectId ?? "")!;
    const execution = executed.get(effect.id);
    const target = resources.get(effect.resourceIds[0]!)!;
    const legacyTarget = String(target.metadata.legacyWorldEntityId ?? "");
    const actor = world.getEntity("astra");
    const place = world.getEntity(legacyTarget);
    const confirmed = effect.action === "goto"
      ? !!actor?.transform && !!place?.transform &&
        JSON.stringify(actor.transform.position) === JSON.stringify(place.transform.position)
      : effect.action === "say"
        ? execution?.type === "agent.said" &&
          execution.payload.text === (effect.parameters as Record<string, unknown>)?.text
        : effect.action === "use_tool" && execution?.type === "demo.slow.finished";
    return { id: crypto.randomUUID(), subject: request.subject,
      observerId: "demo-world-observer", source: "world", observedAt: clock.now(),
      status: confirmed ? "confirmed" : "unknown",
      expectedPostcondition: request.expectedPostcondition,
      expectedPostconditionHash: postconditionHash(request.expectedPostcondition),
      observedResourceGenerations: { [target.id]: target.generation },
      evidence: confirmed ? [{ kind: "event", reference: `demo:${effect.id}`, metadata: {} }] : [],
      reason: confirmed ? "demo world state observed" : "demo world state unknown", metadata: {} };
  } });
  const runner = new GovernedActionRunner({ actions, executors, observers, contracts,
    resources, budgets, effects, coordinator, observationService, reconciliation,
    facts, gate, events: { append: event => emit({ id: crypto.randomUUID(),
      timestamp: event.at, type: "control.event", taskId: event.taskId,
      intentId: event.intentId, payload: { controlEventType: event.type,
        effectId: event.effectId, detail: event.detail } }) },
    ids: { next: () => crypto.randomUUID() }, now: clock.now, observationMaxAgeMs: 30000,
    transaction: durable ? work => durable.kernel.transaction(work) : undefined,
    beforeExecutorDispatch: durable?.beforeExecutorDispatch,
    beforeCommitGate: durable?.beforeCommitGate,
    afterExecutorResponse: durable?.afterExecutorResponse,
    afterObservationPersisted: durable?.afterObservationPersisted });
  const completion = new TaskCompletionEvaluator(contracts, effects, observations,
    observers, observationPolicy);
  const recovery = new RecoveryManager({ effects, coordinator, observations,
    observers, observationPolicy, budgets,
    queue: reconciliationQueue, reconciliation, emergencyStop, quarantines,
    mode: runtimeMode, now: clock.now,
    criticalStoresHealthy: () => durable?.kernel.isHealthy() ?? true,
    policyHealthy: () => true,
    resourcesHealthy: () => durable?.kernel.isHealthy() ?? true,
    authorityReadable: () => durable?.kernel.isHealthy() ?? true,
    startupSupervisorHealthy: () => {
      const state = snapshot();
      const decision = supervisor.tick(state);
      return supervisor.mayStart(state, "consequential") &&
        !decision.actions.some(action => action.kind === "stop_before_dispatch" ||
          action.kind === "mark_runtime_degraded");
    },
    events: { append: event => emit({ id: crypto.randomUUID(), timestamp: event.at,
      type: "control.event", payload: { controlEventType: event.type,
        planId: event.planId, actionId: event.actionId, reason: event.reason } }) } });
  const taskEffects = new Map<string, string[]>();

  async function ensureTask(taskId: string, principalId: string, scope?: {
    resourceIds: ResourceId[]; actions: string[]; objective: string;
    metadata?: Record<string, unknown> }): Promise<void> {
    if (await contracts.getForTask(taskId)) return;
    const now = clock.now();
    if (stores && !stores.tasks.get(taskId)) stores.tasks.create({ id: taskId,
      principalId, createdAt: now });
    const grantId = `grant:${taskId}`;
    const allowedActions = filesystem
      ? ["goto", "say", "use_tool", "file.read", "file.write"]
      : ["goto", "say", "use_tool"];
    const resourceIds = scope?.resourceIds ?? safeResources;
    const taskActions = scope?.actions ?? allowedActions;
    const grant: AuthorityGrantView = { id: grantId, version: 1, subjectPrincipalId: principalId,
      resourceIds, actions: taskActions,
      issuedAt: now, expiresAt: now + 3600000 };
    if (stores) {
      if (!stores.grants.getGrant(grantId)) stores.grants.create(grant);
    } else (grants as Map<string, AuthorityGrantView>).set(grantId, grant);
    if (!authorityStore.get(`authority:${taskId}`)) authorityService.issue({ id: `authority:${taskId}`, grantId,
      subjectPrincipalId: principalId, taskId, resourceIds,
      actions: taskActions, notBefore: now, expiresAt: now + 3600000 });
    if (!budgets.getBudget(`budget:${taskId}`)) budgets.createBudget({ id: `budget:${taskId}`, ownerPrincipalId: principalId,
      taskId, ceiling: scope ? { actions: "100", bytes: "10485760",
        inference_tokens: "32768" } : filesystem ? { actions: "100", bytes: "10485760" } :
        { actions: "100" }, expiresAt: now + 3600000 });
    await contracts.create({ id: `contract:${taskId}`, ownerPrincipalId: principalId, taskId,
      objective: scope?.objective ?? "Execute authorized M5 demo actions",
      acceptanceCriteria: ["required actions observed"],
      forbiddenEffects: ["external transfer", "payment"], allowedResourceIds: resourceIds,
      maxRisk: filesystem ? "R2" : "R1", privacyClass: "local_only", budgetId: `budget:${taskId}`,
      authorityLeaseId: `authority:${taskId}`, createdAt: now, version: 1,
      status: "active", metadata: scope?.metadata ?? {} });
  }

  async function prepareGoalTask(input: { taskId: string; principalId: string;
    targetId: string; action: "file.write" | "file.read"; objective: string;
    expectedSha256?: string }): Promise<void> {
    if (!filesystem || input.principalId !== "astra") throw new Error("GOAL_HOST_SCOPE_DENIED");
    const resolved = new ResourceResolver(resources).resolve(input.targetId,
      { expectedKinds: ["file"] });
    if (!resolved.ok) throw new Error(`RESOURCE_${resolved.reason}`);
    filesystem.pathForResource(resolved.resource.id,
      input.action === "file.read" ? "read" : "write");
    await ensureTask(input.taskId, input.principalId, {
      resourceIds: [resolved.resource.id], actions: [input.action],
      objective: input.objective,
      metadata: { source: "human_goal", expectedSha256: input.expectedSha256 ?? null }
    });
  }

  function authorizeInference(taskId: string, objectId: string): boolean {
    return flow.evaluate({ taskId, intentId: `inference:${taskId}`,
      objectIds: [objectId], sinkId: inferenceSinkId }).verdict === "allow";
  }
  function pauseGoalTask(taskId: string): void {
    const task = stores?.tasks.get(taskId);
    if (task?.status === "running") stores?.tasks.setStatus(taskId, "paused", task.version);
  }
  function reserveInference(taskId: string, principalId: string,
    requestId: string, attempt: number): string {
    const budget = budgets.getBudget(`budget:${taskId}`);
    if (!budget || budget.ownerPrincipalId !== principalId) {
      throw new Error("INFERENCE_BUDGET_UNAVAILABLE");
    }
    const id = `inference:${requestId}:${attempt}`;
    budgets.reserve({ id, budgetId: budget.id, principalId, taskId,
      amount: { inference_tokens: "16384" },
      metadata: { kind: "local_inference", requestId, attempt } }, budget.version);
    return id;
  }
  function settleInference(id: string, principalId: string, taskId: string,
    usage?: { inputTokens?: number; outputTokens?: number }): void {
    const reservation = budgets.getReservation(id);
    if (!reservation || reservation.status !== "active") return;
    const identity = { principalId, taskId };
    if (Number.isSafeInteger(usage?.inputTokens) &&
      Number.isSafeInteger(usage?.outputTokens) &&
      usage!.inputTokens! >= 0 && usage!.outputTokens! >= 0) {
      budgets.commitReservation(id, identity,
        { inference_tokens: String(usage!.inputTokens! + usage!.outputTokens!) },
        reservation.version);
    } else budgets.releaseReservation(id, identity, reservation.version);
  }

  async function run(intent: ActionIntent, taskId: string, correlationId: string,
    planId?: string, signal?: AbortSignal, options?: { flowObjectIds?: string[];
      compositionApprovalId?: string; releaseApprovalId?: string }): Promise<GovernedResult> {
    const fileDenial = (reasonCode: string): GovernedResult => {
      emit({ id: crypto.randomUUID(), timestamp: clock.now(), type: "control.event",
        taskId, intentId: intent.id, payload: { controlEventType: "action.admission_denied",
          reasonCode } });
      return { status: "denied", taskId, intentId: intent.id, observationIds: [],
        reasonCode };
    };
    if (durable && (runtimeMode.mode !== "normal" || !durable.kernel.isHealthy())) {
      return { status: "blocked", taskId, intentId: intent.id, observationIds: [],
        reasonCode: "RUNTIME_READ_ONLY" };
    }
    const fileAction = intent.action === "file.read" || intent.action === "file.write";
    if (intent.actorId !== "astra" ||
      (!["goto", "say", "use_tool"].includes(intent.action) && !(fileAction && filesystem)) ||
      (intent.action === "use_tool" && intent.parameters?.tool !== "demo.slow")) {
      return { status: "denied", taskId, intentId: intent.id, observationIds: [],
        reasonCode: "DEMO_ACTION_NOT_REGISTERED" };
    }
    let targetText = intent.action === "say" ? "astra" : intent.action === "use_tool"
      ? "demo.slow" : intent.targetId ?? "";
    if (fileAction) {
      try { targetText = validateLogicalPath(targetText); }
      catch { return fileDenial("INVALID_LOGICAL_PATH"); }
    }
    const resolved = new ResourceResolver(resources).resolve(targetText);
    if (!resolved.ok) return fileAction ? fileDenial(`RESOURCE_${resolved.reason}`) :
      { status: "denied", taskId, intentId: intent.id, observationIds: [],
        reasonCode: `RESOURCE_${resolved.reason}` };
    if (fileAction) {
      try { filesystem!.pathForResource(resolved.resource.id,
        intent.action === "file.read" ? "read" : "write"); }
      catch { return fileDenial("FILE_RESOURCE_NOT_AUTHORIZED"); }
    }
    await ensureTask(taskId, intent.actorId);
    if (intent.action === "file.write") {
      let hash: string;
      try { hash = expectedBytes(intent.parameters ?? {}).sha256; }
      catch { return fileDenial("INVALID_WRITE_PARAMETERS"); }
      const ids = options?.flowObjectIds ?? [];
      const object = ids.length === 1 ? objects.get(ids[0]!) : null;
      if (!object || object.taskId !== taskId || object.metadata.sha256 !== hash) {
        return fileDenial("DATA_OBJECT_CONTENT_MISMATCH");
      }
    }
    let held = null;
    try {
      held = intent.action === "goto" || intent.action === "file.write"
        ? resourceLeases.acquire({ id: crypto.randomUUID(),
        resourceId: resolved.resource.id, holderPrincipalId: intent.actorId, taskId,
        expiresAt: clock.now() + 30000 }) : null;
    } catch (error) {
      return { status: "blocked", taskId, intentId: intent.id, observationIds: [],
        reasonCode: error instanceof Error ? error.message : "RESOURCE_BUSY" };
    }
    let prepared;
    try {
      prepared = await runner.admit({ taskId, principalId: intent.actorId,
        contractId: `contract:${taskId}`, intent: { ...intent, targetId: targetText },
        authorityLeaseId: `authority:${taskId}`, resourceLeaseId: held?.id,
        fencingToken: held?.fencingToken, correlationId, planId,
        flowObjectIds: options?.flowObjectIds,
        flowSinkId: intent.action === "file.write" ? resolved.resource.id : undefined,
        compositionApprovalId: options?.compositionApprovalId,
        releaseApprovalId: options?.releaseApprovalId });
    } catch (error) {
      if (held && resourceLeases.get(held.id)?.status === "active") {
        const current = resourceLeases.get(held.id)!;
        resourceLeases.release(current.id, current.version);
      }
      return { status: "denied", taskId, intentId: intent.id, observationIds: [],
        reasonCode: error instanceof Error ? error.message : "GOVERNANCE_ERROR" };
    }
    if (stores) {
      const task = stores.tasks.get(taskId)!;
      stores.tasks.addRequiredEffect(taskId, prepared.effectId, task.version);
    } else taskEffects.set(taskId, [...(taskEffects.get(taskId) ?? []), prepared.effectId]);
    durable?.beforePreparedDispatch?.();
    try {
      const result = await runner.dispatchPrepared(prepared, signal);
      if (held && result.status !== "unknown") {
        const current = resourceLeases.get(held.id);
        if (current?.status === "active") resourceLeases.release(current.id, current.version);
      }
      if (result.status === "completed" && intent.action === "file.read") {
        const bytes = filesystemRead?.takeReadResult(prepared.effectId);
        if (bytes) {
          const label = resolved.resource.dataLabel;
          const objectId = `file-read:${prepared.effectId}`;
          objects.addSource({ id: objectId, taskId,
            resourceId: resolved.resource.id, origin: "resource", createdAt: clock.now(),
            label: { confidentiality: label?.sensitivity ?? "secret",
              categories: [], jurisdictions: [], ownerPrincipalIds: [],
              releasable: label?.sensitivity === "public", metadata: {} },
            metadata: { sha256: createHash("sha256").update(bytes).digest("hex"),
              byteLength: bytes.length } });
          const version = workingSets.get(taskId).version;
          workingSets.add(taskId, objectId, version);
        }
      }
      if (result.status === "completed" && intent.action === "file.write") {
        const current = resources.get(resolved.resource.id)!;
        resources.update({ ...current, generation: current.generation + 1,
          metadata: { ...current.metadata,
            lastObservedSha256: expectedBytes(intent.parameters ?? {}).sha256,
            lastObservedEffectId: result.effectId } }, current.version);
      }
      return result;
    } catch (error) {
      return { status: "unknown", taskId, intentId: intent.id, effectId: prepared.effectId,
        observationIds: [], reasonCode: error instanceof Error
          ? error.message : "DISPATCH_OUTCOME_UNKNOWN" };
    }
  }

  async function mayComplete(taskId: string): Promise<boolean> {
    if (stores?.tasks.get(taskId)?.status === "completed") return true;
    const requiredEffectIds = stores?.tasks.get(taskId)?.requiredEffectIds ??
      taskEffects.get(taskId) ?? [];
    const last = requiredEffectIds.at(-1);
    if (!last) return false;
    const riskClass = (effects.get(last)?.metadata.riskClass ?? "R1") as ContractRisk;
    const acceptanceEvidence: TaskAcceptanceEvidence[] = [{ criterion: "required actions observed",
      effectId: last, riskClass }];
    const complete = (await completion.evaluate({ taskId, contractId: `contract:${taskId}`,
      requiredEffectIds, acceptanceEvidence, maxObservationAgeMs: 30000,
      pendingApprovalCount: 0 })).complete;
    if (complete && stores) {
      const task = stores.tasks.get(taskId);
      if (task?.status === "running") stores.tasks.setStatus(taskId, "completed", task.version);
    }
    return complete;
  }
  async function stageTrustedContent(taskId: string, principalId: string,
    content: string, label: DataLabel): Promise<string> {
    if (!filesystem) throw new Error("FILESYSTEM_NOT_CONFIGURED");
    await ensureTask(taskId, principalId);
    const bytes = Buffer.from(content, "utf8");
    const id = `content:${crypto.randomUUID()}`;
    objects.addSource({ id, taskId, label: structuredClone(label), origin: "human",
      createdAt: clock.now(), metadata: { sha256: createHash("sha256")
        .update(bytes).digest("hex"), byteLength: bytes.length } });
    workingSets.add(taskId, id, workingSets.get(taskId).version);
    return id;
  }
  function repairConfirmedFilesystemEffect(effectId: string): void {
    const effect = effects.get(effectId);
    if (!effect || effect.status !== "unknown" ||
      !["filesystem-write", "filesystem-read"].includes(effect.executorId)) return;
    const decision = reconciliationQueue.listDecisions(effectId).at(-1);
    if (decision?.outcome !== "confirmed_effect" || !decision.observationIds.length) return;
    const riskClass = effect.metadata.riskClass as ContractRisk;
    const maxAgeMs = effect.metadata.observationMaxAgeMs as number;
    const settle = () => {
      const committed = coordinator.confirmUnknownFromReconciliation(effect.id,
        effect.version, decision.observationIds[0]!, decision.id,
        { riskClass, maxAgeMs });
      for (const id of committed.budgetReservationIds) {
        const reservation = budgets.getReservation(id);
        if (reservation?.status === "active") budgets.commitHeldReservation(id,
          { principalId: reservation.principalId, taskId: reservation.taskId },
          committed.metadata.budgetActualAmount as Record<string, string>,
          reservation.version);
      }
      facts.fromEffectFacts(committed.id);
      repairFilesystemGeneration(committed.id);
    };
    if (durable) durable.kernel.transaction(settle);
    else settle();
  }

  function repairFilesystemGeneration(effectId: string): void {
    const effect = effects.get(effectId);
    if (effect?.status !== "committed" || effect.executorId !== "filesystem-write") return;
    const id = effect.resourceIds[0]!;
    const resource = resources.get(id);
    if (!resource || resource.metadata.lastObservedEffectId === effect.id) return;
    resources.update({ ...resource, generation: resource.generation + 1,
      metadata: { ...resource.metadata, lastObservedEffectId: effect.id,
        lastObservedSha256: (effect.expectedPostcondition.expected as
          { sha256?: string }).sha256 } }, resource.version);
  }

  async function reconcilePendingFilesystem(): Promise<void> {
    for (const job of reconciliationQueue.list()) {
      const effect = effects.get(job.effectId);
      if (!effect || effect.status !== "unknown" ||
        !["filesystem-write", "filesystem-read"].includes(effect.executorId) ||
        job.status !== "queued" || job.nextAttemptAt > clock.now()) continue;
      await reconciliation.run(job.id, { riskClass: effect.metadata.riskClass as ContractRisk,
        maxAgeMs: effect.metadata.observationMaxAgeMs as number });
      repairConfirmedFilesystemEffect(effect.id);
    }
  }

  function recoverOnStartup() {
    const result = recovery.run();
    if (filesystem && (durable?.kernel.isHealthy() ?? true)) {
      for (const effect of effects.list()) {
        repairConfirmedFilesystemEffect(effect.id);
        repairFilesystemGeneration(effect.id);
      }
    }
    return result;
  }
  return { run, mayComplete, recoverOnStartup, reconcilePendingFilesystem,
    stageTrustedContent, prepareGoalTask, authorizeInference, pauseGoalTask,
    reserveInference, settleInference,
    runtimeMode, stopTask: (id: string) => {
      stoppedTasks.add(id);
      const task = stores?.tasks.get(id);
      if (task?.status === "running") stores?.tasks.setStatus(id, "cancelled", task.version);
    },
    activateEmergencyStop: (reason: string) => emergencyStop.activate(reason, clock.now()),
    quarantineExecutor: (executorId: string, reason: string) => quarantines.add({
      id: crypto.randomUUID(), executorId, reason, createdAt: clock.now(), active: true }) };
}
