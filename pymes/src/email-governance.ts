import { randomUUID } from "node:crypto";
import {
  GovernedActionRunner,
  GovernedActionRegistry,
  ExecutorRegistry,
  LiveCommitGate,
  type GovernedActionRequest,
} from "@agent-world/control-plane";
import {
  ActionRegistry,
  CandidateCompiler,
  CompositionEngine,
  defaultCompositionRules,
  FactCompiler,
} from "@agent-world/composition-policy";
import { ContractValidator } from "@agent-world/contracts";
import {
  EffectCoordinator,
  type EffectTransaction,
} from "@agent-world/effects";
import { FlowEngine, defaultFlowRules } from "@agent-world/information-flow";
import {
  AuthorityLeaseService,
  AuthorityLeaseValidator,
  LeaseCommitGate,
} from "@agent-world/leases";
import {
  InMemoryObserverRegistry,
  ObservationPolicy,
  ObservationService,
  postconditionHash,
  type Observation,
} from "@agent-world/observation";
import {
  ReconciliationService,
  resolveEffectiveEffectOutcome,
} from "@agent-world/reconciliation";
import { RecoveryManager, RuntimeModeController } from "@agent-world/recovery";
import { mintResourceId } from "@agent-world/resources";
import {
  SupervisorEngine,
  type RuntimeSnapshot,
} from "@agent-world/supervision";
import type {
  JournalKernel,
  createDurableDomainStores,
} from "@agent-world/runtime-store-sqlite";
import { emailHash, EmailDispatchError, type EmailProvider } from "./email-provider.js";
import type { EmailReview, EmailReviewStore } from "./email-review-store.js";
type Stores = ReturnType<typeof createDurableDomainStores>;

/** Only adapter wiring and host scope. Dispatch/settlement belongs to existing C11. */
export function createEmailGovernance(
  journal: JournalKernel,
  s: Stores,
  reviews: EmailReviewStore,
  provider: EmailProvider,
  hooks: { beforeDispatch?: () => void; afterDispatchMarker?: () => void } = {},
) {
  const now = journal.clock.now,
    mode = new RuntimeModeController();
  const observers = new InMemoryObserverRegistry(),
    policy = new ObservationPolicy({ now }, s.resources);
  const observationService = new ObservationService(
    observers,
    s.observations,
    policy,
    { now },
  );
  const coordinator = new EffectCoordinator(
    s.effects,
    s.observations,
    observers,
    policy,
    s.effectEvents,
    { now },
  );
  const actionsC8 = new ActionRegistry();
  actionsC8.register({
    actionType: "email.send",
    actionClass: "external_send",
  });
  const composition = new CompositionEngine(
    new CandidateCompiler(actionsC8, s.resources),
    s.history,
    s.compositionApprovals,
    [
      ...defaultCompositionRules(),
      {
        id: "EMAIL_ALWAYS_REVIEW",
        version: "1",
        evaluate: () => ({
          ruleId: "EMAIL_ALWAYS_REVIEW",
          verdict: "require_approval",
          reason: "Email requires exact human review",
        }),
      },
    ],
    { now },
  );
  const flow = new FlowEngine(
    s.dataObjects,
    s.workingSets,
    s.sinks,
    s.releaseApprovals,
    defaultFlowRules(),
    now,
  );
  const facts = new FactCompiler(
    s.history,
    s.effects,
    s.observations,
    observers,
    policy,
    actionsC8,
    {},
  );
  const observerId = "email-mailbox-observer";
  async function observe(
    effect: EffectTransaction,
    reconcile: boolean,
    signal: AbortSignal,
  ): Promise<Observation> {
    const receipt = await (reconcile
      ? provider.reconcile(effect.idempotencyKey, signal)
      : provider.observe(effect.idempotencyKey, signal));
    const expectedHash = emailHash(provider.prepare(effect.parameters));
    const confirmed =
      receipt?.key === effect.idempotencyKey &&
      receipt.payloadHash === expectedHash;
    return {
      id: randomUUID(),
      subject: {
        taskId: effect.taskId,
        intentId: effect.intentId,
        executionId: effect.executionId,
        effectId: effect.id,
        resourceIds: effect.resourceIds,
      },
      observerId,
      source: "provider",
      status: confirmed ? "confirmed" : "unknown",
      observedAt: now(),
      expectedPostcondition: effect.expectedPostcondition,
      expectedPostconditionHash: postconditionHash(
        effect.expectedPostcondition,
      ),
      observedResourceGenerations: Object.fromEntries(
        effect.resourceIds.map((id) => [id, s.resources.get(id)!.generation]),
      ),
      evidence: confirmed
        ? [
            {
              kind: "event",
              reference: receipt!.id,
              metadata: { payloadHash: receipt!.payloadHash },
            },
          ]
        : [],
      reason: confirmed
        ? "Persisted mailbox receipt matches exact payload"
        : "Mailbox evidence unavailable",
      metadata: {
        provider: provider.id,
        simulated: provider.id === "fake-email",
      },
    };
  }
  observers.register({
    descriptor: {
      id: observerId,
      implementation: "Read-only mailbox receipt lookup",
      sourceType: "provider",
      independence: "independent_local",
      strength: "strong",
      authenticated: true,
      metadata: {
        provider: provider.id,
        simulated: provider.id === "fake-email",
      },
    },
    observe: async (req, signal) =>
      observe(s.effects.get(req.subject.effectId!)!, false, signal),
  });
  const reconciliation = new ReconciliationService(
    s.effects,
    s.reconciliations,
    s.observations,
    observers,
    policy,
    [
      {
        id: "email-reconciler",
        supports: (e) => e.action === "email.send",
        reconcile: async (e, _attempt, signal) => ({
          kind: "observations",
          observations: [await observe(e, true, signal)],
        }),
      },
    ],
    now,
  );
  const snapshot = (): RuntimeSnapshot => ({
    now: now(),
    tasks: [],
    authorityLeases: [],
    resourceLeases: [],
    budgets: [],
    effects: s.effects.list().map((e) => ({
      id: e.id,
      taskId: e.taskId,
      executorId: "email-provider",
      status: e.status,
      createdAt: e.createdAt,
      preparedAt: e.preparedAt,
      dispatchStartedAt: e.dispatchStartedAt,
      observationIds: e.observationIds,
      required: true,
      effectiveOutcome: resolveEffectiveEffectOutcome(
        e,
        s.reconciliations.listDecisions(e.id),
      ).effectiveOutcome,
    })),
    reconciliations: s.reconciliations.list(),
    components: [{ id: "email-provider", kind: "executor", healthy: true }],
    quarantines: s.quarantines.list(),
    emergencyStop: s.emergencyStop.get(),
    policyAvailable: true,
    eventStoreAvailable: journal.isHealthy(),
    unknownRateByExecutor: {},
  });
  const supervisor = new SupervisorEngine({
    stalledTaskMs: 60000,
    preparingMs: 60000,
    dispatchingMs: 60000,
    maxUnknownBacklog: 10,
    highUnknownRate: 1,
  });
  const gate = new LiveCommitGate({
    contracts: s.contracts,
    contractValidator: new ContractValidator(),
    resources: s.resources,
    leases: new LeaseCommitGate(
      new AuthorityLeaseValidator(s.grants, s.authorityLeases, { now }),
      s.resourceLeases,
      { now },
    ),
    resourceLeases: s.resourceLeases,
    budgets: s.budgets,
    effects: s.effects,
    composition,
    flow,
    supervisor,
    snapshot,
    tasks: {
      isRunnable: (id) => s.tasks.isRunnable(id) && journal.isHealthy(),
    },
    runtimeMode: mode,
    now,
  });
  const definitions = new GovernedActionRegistry();
  definitions.register({
    action: "email.send",
    executorId: "email-provider",
    observerId,
    risk: "R2",
    resourceKinds: ["sink_email"],
    requiresResourceLease: true,
    requiresFlow: true,
    strictDecisionVersions: true,
    budgetAmount: { actions: "1" },
    budgetForIntent: (intent) => ({
      actions: "1",
      network_bytes: String(
        Buffer.byteLength(JSON.stringify(provider.prepare(intent.parameters))),
      ),
    }),
    reservationTtlMs: 30000,
    expectedPostcondition: (id, intent) => ({
      kind: "email_sent",
      resourceIds: [id],
      predicate: "hash",
      expected: { payloadHash: emailHash(provider.prepare(intent.parameters)) },
      metadata: { provider: provider.id },
    }),
  });
  const executors = new ExecutorRegistry();
  executors.register({
    id: "email-provider",
    dispatch: async (context, signal) => {
      try {
        const receipt = await provider.send(
          provider.prepare(context.parameters),
          context.idempotencyKey,
          signal,
        );
        return {
          kind: "reported_success",
          externalReference: receipt.id,
          metadata: { provider: provider.id },
        };
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "FAKE_EMAIL_CERTIFIED_NOT_STARTED" || error instanceof EmailDispatchError && error.certainty === "not_started")
        )
          return {
            kind: "reported_failure",
            certainty: "certified_not_started",
            reason: "Provider certified rejection before send",
            metadata: {},
          };
        throw error;
      }
    },
  });
  const audit = (taskId: string, type: string, reference: string) =>
    reviews.audit({ id: randomUUID(), taskId, type, reference, at: now() });
  let dispatchGuard = () => {};
  let executing = false;
  function assertReview(r: EmailReview, decisionId: string) {
    const latest = reviews.latest(r.taskId),
      d = reviews.decision(r.id);
    if (
      !latest ||
      latest.id !== r.id ||
      emailHash(latest) !== emailHash(r) ||
      emailHash(r.payload) !== r.payloadHash ||
      d?.decision !== "approved" ||
      d.id !== decisionId ||
      d.bindingHash !== r.bindingHash ||
      d.userId !== r.owner
    )
      throw new Error("EMAIL_APPROVAL_BINDING_DENIED");
  }
  const runner = new GovernedActionRunner({
    actions: definitions,
    executors,
    observers,
    contracts: s.contracts,
    resources: s.resources,
    budgets: s.budgets,
    effects: s.effects,
    coordinator,
    observationService,
    reconciliation,
    facts,
    gate,
    events: {
      append: (e) => audit(e.taskId, e.type, e.effectId ?? e.intentId),
    },
    ids: { next: () => randomUUID() },
    now,
    observationMaxAgeMs: 30000,
    transaction: (work) => journal.transaction(work),
    beforeCommitGate: () => {
      dispatchGuard();
      hooks.beforeDispatch?.();
      dispatchGuard();
    },
    beforeExecutorDispatch: () => {
      dispatchGuard();
      hooks.afterDispatchMarker?.();
      dispatchGuard();
    },
  });
  const recovery = new RecoveryManager({
    effects: s.effects,
    coordinator,
    observations: s.observations,
    observers,
    observationPolicy: policy,
    budgets: s.budgets,
    queue: s.reconciliations,
    reconciliation,
    emergencyStop: s.emergencyStop,
    quarantines: s.quarantines,
    mode,
    now,
    criticalStoresHealthy: () => journal.isHealthy(),
    policyHealthy: () => true,
    resourcesHealthy: () => journal.isHealthy(),
    authorityReadable: () => journal.isHealthy(),
    events: {
      append: (e) => {
        for (const taskId of new Set(
          s.effects
            .list()
            .filter(
              (effect) =>
                effect.action === "email.send" &&
                (!e.actionId || e.actionId.endsWith(":" + effect.id)),
            )
            .map((effect) => effect.taskId),
        ))
          audit(taskId, e.type, e.actionId ?? e.planId);
      },
    },
  });
  recovery.run();
  function identity(r: EmailReview) {
    return {
      sink: mintResourceId(
        "sink_email",
        // p01-pilot-kill.ts correlates this identity and executor with the C6 key.
        `simulated/${r.owner}/${r.bindingHash}`,
      ),
      intentId: `email:${r.bindingHash}`,
      objectId: `payload:${r.bindingHash}`,
      contractId: `email-contract:${r.bindingHash}`,
      authorityId: `email-authority:${r.bindingHash}`,
      budgetId: `email-budget:${r.bindingHash}`,
      planId: `plan:${r.planHash}`,
    };
  }
  async function prepare(r: EmailReview) {
    provider.prepare(r.payload);
    const x = identity(r),
      at = now();
    if (!s.resources.has(x.sink))
      s.resources.register({
        id: x.sink,
        kind: "sink_email",
        displayName: "Approved email recipient scope",
        aliases: [],
        parentId: null,
        ownerPrincipalId: r.owner,
        dataLabel: null,
        exclusivity: "exclusive",
        sink: {
          external: true,
          trustClass: "external",
          allowedSensitivity: ["public", "internal", "confidential"],
        },
        source: "host",
        metadata: { payloadHash: r.payloadHash, provider: provider.id },
      });
    if (!s.sinks.get(x.sink))
      s.sinks.register({
        id: x.sink,
        kind: "email",
        trust: "external",
        hostControlled: true,
        metadata: {},
      });
    if (!s.tasks.get(r.taskId))
      s.tasks.create({ id: r.taskId, principalId: r.owner, createdAt: at });
    if (!s.grants.getGrant(x.authorityId)) {
      s.grants.create({
        id: x.authorityId,
        version: 1,
        subjectPrincipalId: r.owner,
        resourceIds: [x.sink],
        actions: ["email.send"],
        issuedAt: at,
        expiresAt: at + 3600000,
      });
      new AuthorityLeaseService(s.grants, s.authorityLeases, { now }).issue({
        id: x.authorityId,
        grantId: x.authorityId,
        subjectPrincipalId: r.owner,
        taskId: r.taskId,
        resourceIds: [x.sink],
        actions: ["email.send"],
        notBefore: at,
        expiresAt: at + 3600000,
      });
    }
    if (!s.budgets.getBudget(x.budgetId))
      s.budgets.createBudget({
        id: x.budgetId,
        ownerPrincipalId: r.owner,
        taskId: r.taskId,
        ceiling: { actions: "1", network_bytes: "65536" },
        expiresAt: at + 3600000,
      });
    if (!(await s.contracts.get(x.contractId)))
      await s.contracts.create({
        id: x.contractId,
        ownerPrincipalId: r.owner,
        taskId: r.taskId,
        objective: "Send exact approved email through provider",
        acceptanceCriteria: ["mailbox receipt matches payload hash"],
        forbiddenEffects: ["purchase_compute"],
        allowedResourceIds: [x.sink],
        maxRisk: "R2",
        privacyClass: "local_only",
        budgetId: x.budgetId,
        authorityLeaseId: x.authorityId,
        createdAt: at,
        version: 1,
        status: "active",
        metadata: { bindingHash: r.bindingHash },
      });
    if (!s.dataObjects.get(x.objectId)) {
      s.dataObjects.addSource({
        id: x.objectId,
        taskId: r.taskId,
        label: {
          confidentiality: "confidential",
          categories: ["personal_data"],
          jurisdictions: [],
          ownerPrincipalIds: [r.owner],
          releasable: true,
          metadata: {},
        },
        origin: "human",
        createdAt: at,
        metadata: { payloadHash: r.payloadHash },
      });
      s.workingSets.add(
        r.taskId,
        x.objectId,
        s.workingSets.get(r.taskId).version,
      );
    }
    return x;
  }
  function candidate(r: EmailReview) {
    const x = identity(r);
    return {
      taskId: r.taskId,
      intentId: x.intentId,
      planId: x.planId,
      actionType: "email.send",
      resourceIds: [x.sink],
      sinkId: x.sink,
    };
  }
  async function evaluate(r: EmailReview) {
    const x = await prepare(r);
    return {
      composition: composition.evaluate(candidate(r)),
      flow: flow.evaluate({
        taskId: r.taskId,
        intentId: x.intentId,
        objectIds: [x.objectId],
        sinkId: x.sink,
      }),
    };
  }
  function approve(r: EmailReview, decisionId: string) {
    assertReview(r, decisionId);
    const x = identity(r),
      at = now();
    s.compositionApprovals.append({
      id: decisionId,
      taskId: r.taskId,
      intentId: x.intentId,
      actionType: "email.send",
      resourceIds: [x.sink],
      sinkId: x.sink,
      historyVersion: s.history.currentVersion(r.taskId),
      issuedAt: at,
      expiresAt: at + 3600000,
      issuerId: r.owner,
    });
    s.releaseApprovals.append({
      id: decisionId,
      taskId: r.taskId,
      intentId: x.intentId,
      sinkId: x.sink,
      objectIds: [x.objectId],
      workingSetVersion: s.workingSets.get(r.taskId).version,
      issuedAt: at,
      expiresAt: at + 3600000,
      issuerId: r.owner,
    });
  }
  function effectsFor(r: EmailReview) {
    return s.effects
      .list()
      .filter(
        (e) => e.taskId === r.taskId && e.intentId === identity(r).intentId,
      );
  }
  async function execute(
    r: EmailReview,
    decisionId: string,
    authorize: () => void = () => {},
  ) {
    assertReview(r, decisionId);
    authorize();
    if (executing) throw new Error("EMAIL_BUSY");
    if (effectsFor(r).length) throw new Error("EMAIL_ALREADY_DISPATCH_CLAIMED");
    const x = identity(r),
      lease = s.resourceLeases.acquire({
        id: randomUUID(),
        resourceId: x.sink,
        holderPrincipalId: r.owner,
        taskId: r.taskId,
        expiresAt: now() + 30000,
      });
    const request: GovernedActionRequest = {
      taskId: r.taskId,
      principalId: r.owner,
      contractId: x.contractId,
      intent: {
        id: x.intentId,
        actorId: r.owner,
        action: "email.send",
        targetId: x.sink,
        parameters: structuredClone(r.payload) as unknown as Record<
          string,
          unknown
        >,
        provenance: { source: "human" },
      },
      authorityLeaseId: x.authorityId,
      resourceLeaseId: lease.id,
      fencingToken: lease.fencingToken,
      flowObjectIds: [x.objectId],
      flowSinkId: x.sink,
      compositionApprovalId: decisionId,
      releaseApprovalId: decisionId,
      planId: x.planId,
      correlationId: r.id,
    };
    executing = true;
    dispatchGuard = () => {
      assertReview(r, decisionId);
      authorize();
    };
    try {
      const prepared = await runner.admit(request);
      return await runner.dispatchPrepared(prepared);
    } catch (error) {
      const effect = effectsFor(r).at(-1);
      if (effect?.status === "dispatching") {
        coordinator.markDispatchingUnknownAfterCrash(effect.id, effect.version);
        if (!s.reconciliations.findByEffect(effect.id))
          reconciliation.enqueue(`uncertain:${effect.id}`, effect.id, 3);
      }
      throw error;
    } finally {
      executing = false;
      dispatchGuard = () => {};
      const current = s.resourceLeases.get(lease.id);
      if (current?.status === "active")
        s.resourceLeases.release(current.id, current.version);
    }
  }
  async function reconcile(r: EmailReview) {
    for (const effect of effectsFor(r)) {
      if (effect.status !== "unknown") continue;
      const job = s.reconciliations.findByEffect(effect.id);
      if (job?.status === "queued" && job.nextAttemptAt <= now())
        await reconciliation.run(job.id, { riskClass: "R2", maxAgeMs: 30000 });
      const effective = resolveEffectiveEffectOutcome(
        effect,
        s.reconciliations.listDecisions(effect.id),
      );
      if (effective.effectiveOutcome === "committed") {
        journal.transaction(() => {
          for (const id of effect.budgetReservationIds) {
            const reservation = s.budgets.getReservation(id)!;
            if (reservation.status === "active")
              s.budgets.commitHeldReservation(
                id,
                { principalId: r.owner, taskId: r.taskId },
                effect.metadata.budgetActualAmount as Record<string, string>,
                reservation.version,
              );
          }
          if (
            !reviews
              .timeline(r.taskId)
              .some(
                (a) =>
                  a.type === "effect.reconciled" &&
                  a.reference === effective.resolvedByDecisionId,
              )
          )
            audit(
              r.taskId,
              "effect.reconciled",
              effective.resolvedByDecisionId!,
            );
        });
      }
    }
  }
  function view(r: EmailReview) {
    const effects = effectsFor(r);
    return effects.map((e) => ({
      id: e.id,
      status: e.status,
      effective: resolveEffectiveEffectOutcome(
        e,
        s.reconciliations.listDecisions(e.id),
      ).effectiveOutcome,
      observationIds: e.observationIds,
      reconciliations: s.reconciliations.listDecisions(e.id).map((d) => ({
        id: d.id,
        outcome: d.outcome,
        observationIds: d.observationIds,
      })),
    }));
  }
  return {
    evaluate,
    approve,
    execute,
    reconcile,
    view,
    mode,
    stores: s,
    identity,
    audit,
  };
}
