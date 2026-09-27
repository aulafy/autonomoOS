import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EffectCoordinator } from "@agent-world/effects";
import { AuthorityLeaseService, AuthorityLeaseValidator } from "@agent-world/leases";
import { InMemoryObserverRegistry, ObservationPolicy, postconditionHash } from "@agent-world/observation";
import { mintResourceId } from "@agent-world/resources";
import { createDurableDomainStores, JournalKernel, ReplayClock,
  RuntimeDatabase } from "../src/index.js";

test("all critical control facts reopen from the one SQLite journal", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-h1-domain-"));
  const path = join(directory, "runtime.db");
  const place = mintResourceId("world_place", "demo/room");
  const sink = mintResourceId("sink_email", "demo/outbound");
  let now = 100;
  const open = async () => {
    const clock = new ReplayClock(() => now);
    const database = new RuntimeDatabase(path, clock.now);
    const kernel = new JournalKernel(database, clock);
    const stores = createDurableDomainStores(kernel);
    await kernel.restore();
    return { database, kernel, clock, ...stores };
  };
  try {
    const a = await open();
    for (const [id, kind, sinkMeta] of [
      [place, "world_place", null],
      [sink, "sink_email", { external: true, trustClass: "external",
        allowedSensitivity: ["public"] }]
    ] as const) a.resources.register({ id, kind, displayName: id, aliases: [],
      parentId: null, dataLabel: null, exclusivity: "shared", source: "host",
      sink: sinkMeta ? { ...sinkMeta, allowedSensitivity: [...sinkMeta.allowedSensitivity] } : null });
    a.sinks.register({ id: sink, kind: "email", trust: "external",
      hostControlled: true, metadata: {} });
    a.tasks.create({ id: "t1", principalId: "astra", createdAt: now });
    a.grants.create({ id: "g1", version: 1, subjectPrincipalId: "astra",
      resourceIds: [place, sink], actions: ["goto"], issuedAt: now, expiresAt: 200 });
    const authority = new AuthorityLeaseService(a.grants, a.authorityLeases, a.clock);
    authority.issue({ id: "al1", grantId: "g1", subjectPrincipalId: "astra",
      taskId: "t1", resourceIds: [place, sink], actions: ["goto"],
      notBefore: now, expiresAt: 200 });
    await a.contracts.create({ id: "c1", ownerPrincipalId: "astra", taskId: "t1",
      objective: "move", acceptanceCriteria: ["at room"], forbiddenEffects: [],
      allowedResourceIds: [place, sink], maxRisk: "R1", privacyClass: "local_only",
      budgetId: "b1", authorityLeaseId: "al1", createdAt: now, version: 1,
      status: "active", metadata: {} });
    a.budgets.createBudget({ id: "b1", ownerPrincipalId: "astra", taskId: "t1",
      ceiling: { actions: "5" } });
    a.budgets.reserve({ id: "r1", budgetId: "b1", principalId: "astra", taskId: "t1",
      effectId: "e1", amount: { actions: "1" }, expiresAt: 120 }, 1);
    const lease = a.resourceLeases.acquire({ id: "rl1", resourceId: place,
      holderPrincipalId: "astra", taskId: "t1", expiresAt: 200 });
    a.history.append({ id: "h1", taskId: "t1", kind: "sensitive_read",
      occurredAt: now, source: "trusted_control_event", sourceId: "event-1",
      resourceIds: [place], metadata: {} });
    a.compositionApprovals.append({ id: "approval-1", taskId: "t1", intentId: "i1",
      actionType: "goto", resourceIds: [place], historyVersion: 1,
      issuedAt: now, expiresAt: 200, issuerId: "human" });
    a.dataObjects.addSource({ id: "secret", taskId: "t1", label: {
      confidentiality: "secret", categories: [], jurisdictions: [],
      ownerPrincipalIds: [], releasable: false, metadata: {} }, origin: "human",
      createdAt: now, metadata: {} });
    a.dataObjects.derive({ id: "summary", taskId: "t1", createdAt: now,
      metadata: {} }, ["secret"], "summarize");
    a.workingSets.add("t1", "summary", 0);
    a.releaseApprovals.append({ id: "release-1", taskId: "t1", intentId: "i1",
      objectIds: ["summary"], sinkId: sink, workingSetVersion: 1,
      issuedAt: now, expiresAt: 200, issuerId: "human" });
    const observerRegistry = new InMemoryObserverRegistry();
    const policy = new ObservationPolicy(a.clock);
    const coordinator = new EffectCoordinator(a.effects, a.observations,
      observerRegistry, policy, a.effectEvents, a.clock);
    const postcondition = { kind: "world_position", resourceIds: [place],
      predicate: "position" as const, expected: { at: place }, metadata: {} };
    const created = coordinator.createEffect({ id: "e1", taskId: "t1", intentId: "i1",
      executionId: "x1", executorId: "executor", action: "goto", parameters: {},
      expectedPostcondition: postcondition, resourceIds: [place],
      budgetReservationIds: ["r1"], metadata: { riskClass: "R1",
        observationMaxAgeMs: 100, budgetActualAmount: { actions: "1" } } });
    const prepared = coordinator.prepare(created.id, created.version);
    coordinator.startDispatch(prepared.id, prepared.version);
    a.observations.append({ id: "o1", observerId: "observer", source: "world",
      status: "unknown", observedAt: now, subject: { taskId: "t1", intentId: "i1",
        executionId: "x1", effectId: "e1", resourceIds: [place] },
      expectedPostcondition: postcondition, expectedPostconditionHash: postconditionHash(postcondition),
      observedResourceGenerations: {}, evidence: [], reason: "unknown", metadata: {} });
    a.reconciliations.enqueue({ id: "job-1", effectId: "e1", attempts: 0,
      maxAttempts: 3, nextAttemptAt: now, status: "queued", createdAt: now,
      updatedAt: now, version: 1 });
    a.emergencyStop.activate("operator", now);
    a.quarantines.add({ id: "q1", executorId: "executor", reason: "suspect",
      createdAt: now, active: true });
    a.tasks.addRequiredEffect("t1", "e1", 1);
    a.database.close();

    now = 150;
    const b = await open();
    assert.equal(b.kernel.isHealthy(), true);
    assert.equal(b.resources.get(place)?.generation, 1);
    assert.equal((await b.contracts.get("c1"))?.status, "active");
    assert.equal(b.budgets.getBudget("b1")?.reserved.actions, "1");
    assert.equal(b.budgets.getReservation("r1")?.status, "active");
    assert.equal(b.effects.get("e1")?.status, "dispatching");
    assert.equal(b.observations.get("o1")?.status, "unknown");
    assert.equal(b.reconciliations.findByEffect("e1")?.id, "job-1");
    assert.equal(b.history.currentVersion("t1"), 1);
    assert.equal(b.dataObjects.get("summary")?.label?.confidentiality, "secret");
    assert.equal(b.dataObjects.lineageFor("summary").length, 1);
    assert.equal(b.workingSets.get("t1").version, 1);
    assert.equal(b.compositionApprovals.get("approval-1")?.historyVersion, 1);
    assert.equal(b.releaseApprovals.get("release-1")?.workingSetVersion, 1);
    assert.equal(b.emergencyStop.get().active, true);
    assert.equal(b.quarantines.isQuarantined("executor"), true);
    assert.equal(b.tasks.get("t1")?.requiredEffectIds[0], "e1");
    assert.equal(b.effectEvents.list().length, 3);
    const validator = new AuthorityLeaseValidator(b.grants, b.authorityLeases, b.clock);
    assert.equal(validator.validate({ leaseId: "al1", subjectPrincipalId: "astra",
      taskId: "t1", action: "goto", resourceId: place }).allowed, true);
    b.grants.revoke("g1", 1, 151);
    now = 151;
    const revokedDecision = validator.validate({ leaseId: "al1", subjectPrincipalId: "astra",
      taskId: "t1", action: "goto", resourceId: place });
    assert.deepEqual(revokedDecision, { allowed: false, reason: "GRANT_REVOKED" });
    now = 201;
    const nextLease = b.resourceLeases.acquire({ id: "rl2", resourceId: place,
      holderPrincipalId: "astra", taskId: "t1", expiresAt: 250 });
    assert.ok(nextLease.fencingToken > lease.fencingToken);
    b.database.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
