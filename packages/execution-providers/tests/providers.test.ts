import test from "node:test";
import assert from "node:assert/strict";
import { ProviderRegistry, type ProviderAvailability } from "../src/index.js";
import { MockExecutionProvider } from "../src/testing.js";
import { TaskRuntimeKernel, type TaskRuntimeEvent } from "@agent-world/task-runtime";

test("registration, availability and detached actor metadata", async () => {
  const registry = new ProviderRegistry(), provider = new MockExecutionProvider();
  registry.register(provider); assert.equal(registry.actors().length, 0);
  assert.throws(() => registry.register(provider));
  assert.equal((await registry.probeAll())[provider.id]!.status, "available");
  const actors = registry.actors(); actors[0]!.capabilities[0]!.confidence = 0;
  assert.equal(registry.actors()[0]!.capabilities[0]!.confidence, 1);
  provider.availability = { status: "unavailable", reason: "offline" };
  await registry.probe(provider.id); assert.equal(registry.actors().length, 0);
  assert.equal(registry.unregister(provider.id), true); assert.equal(registry.get(provider.id), undefined);
});
test("degraded actors/providers are not automatic execution candidates", async () => {
  const registry = new ProviderRegistry(), provider = new MockExecutionProvider();
  registry.register(provider); provider.actor.availability = "degraded";
  await registry.probe(provider.id); assert.equal(registry.actors().length, 0);
  provider.availability = { status: "degraded", reason: "limited", capabilities: [] };
  await registry.probe(provider.id); assert.equal(registry.actors().length, 0);
});
test("malformed provider metadata fails closed without exposing exception text", async () => {
  const registry = new ProviderRegistry(), provider = new MockExecutionProvider();
  registry.register(provider); provider.actor.capabilities[0]!.confidence = NaN;
  assert.deepEqual(await registry.probe(provider.id), { status: "unavailable", reason: "malformed_provider_metadata" });
  provider.probe = async () => { throw new Error("secret provider exception"); };
  assert.deepEqual(await registry.probe(provider.id), { status: "unavailable", reason: "provider_probe_failed" });
});
test("bounded probe timeout excludes a hung provider", async () => {
  const registry = new ProviderRegistry(10), provider = new MockExecutionProvider();
  provider.probe = () => new Promise(() => {}); registry.register(provider);
  assert.deepEqual(await registry.probe(provider.id), { status: "unavailable", reason: "provider_probe_timeout" });
});
test("unregistering during probe prevents stale metadata from returning", async () => {
  let release!: (value: ProviderAvailability) => void;
  const registry = new ProviderRegistry(), provider = new MockExecutionProvider();
  provider.probe = () => new Promise(resolve => { release = resolve; }); registry.register(provider);
  const pending = registry.probe(provider.id); registry.unregister(provider.id);
  release({ status: "available", capabilities: [] });
  assert.deepEqual(await pending, { status: "unavailable", reason: "stale_probe" }); assert.equal(registry.actors().length, 0);
});
test("mock dispatch is scoped and idempotent; observations preserve uncertainty", async () => {
  const provider = new MockExecutionProvider();
  const input = { taskId: "task", workUnitId: "unit", attemptId: "attempt", actorId: provider.actor.id, objective: "Test", contextRef: "context", authorizationRef: "authorization", resourceRefs: ["fixture"], dispatchFingerprint: "fingerprint" };
  const prepared = await provider.prepare(input); assert.equal(prepared.status, "prepared"); if (prepared.status !== "prepared") return;
  const dispatch = { ...input, handle: prepared.handle };
  assert.equal((await provider.dispatch({ ...dispatch, authorizationRef: "other" })).status, "not-executed");
  const receipt = await provider.dispatch(dispatch); assert.equal(receipt.status, "dispatched"); if (receipt.status !== "dispatched") return;
  assert.deepEqual(await provider.dispatch(dispatch), receipt); assert.equal(provider.dispatchCount, 1);
  for (const status of ["unknown", "unverifiable", "timeout", "not-found"] as const) {
    provider.setObservation(receipt.ref, { status, observedAt: 101, reason: "test" });
    assert.equal((await provider.observe(receipt.ref)).status, status);
  }
  assert.equal((await provider.observe({ provider: "other" })).status, "unverifiable");
});
test("mock drives the complete global lifecycle with host verification, never worker_done completion", async () => {
  const provider = new MockExecutionProvider(), registry = new ProviderRegistry(), kernel = new TaskRuntimeKernel();
  registry.register(provider); await registry.probe(provider.id);
  let sequence = 0;
  const emit = (payload: Record<string, unknown>) => kernel.apply({ id: `e${++sequence}`, taskId: "task", at: sequence, ...payload } as TaskRuntimeEvent, kernel.snapshot().revision);
  const criteria = [{ id: "criterion", kind: "custom", verifierId: "host-test", input: null }];
  emit({ type: "GlobalTaskCreated", goal: "Verify fixture", owner: "owner", successCriteria: criteria });
  emit({ type: "GlobalTaskPlanningStarted" });
  emit({ type: "PlanCommitted", planVersion: 1, workUnits: [{ id: "unit", title: "test", objective: "test fixture", dependencies: [], requiredCapabilities: [{ capability: "test.run" }], constraints: [], expectedArtifacts: [], successCriteria: criteria }] });
  const input = { taskId: "task", workUnitId: "unit", attemptId: "attempt", actorId: registry.actors()[0]!.id, objective: "test fixture", contextRef: "context", authorizationRef: "host-authorization", resourceRefs: ["fixture"], dispatchFingerprint: "fingerprint" };
  emit({ type: "AttemptCreated", workUnitId: input.workUnitId, attemptId: input.attemptId, actorId: input.actorId, dispatchFingerprint: input.dispatchFingerprint, providerId: provider.id });
  const prepared = await provider.prepare(input); assert.equal(prepared.status, "prepared"); if (prepared.status !== "prepared") return;
  emit({ type: "AttemptReserved", attemptId: input.attemptId }); emit({ type: "AttemptDispatchStarted", attemptId: input.attemptId });
  const receipt = await provider.dispatch({ ...input, handle: prepared.handle }); assert.equal(receipt.status, "dispatched"); if (receipt.status !== "dispatched") return;
  emit({ type: "AttemptDispatched", attemptId: input.attemptId, providerRef: receipt.ref });
  provider.setObservation(receipt.ref, { status: "reported-success", observedAt: 101 });
  assert.equal((await provider.observe(receipt.ref)).status, "reported-success");
  emit({ type: "AttemptProviderReported", attemptId: input.attemptId, outcome: "succeeded" });
  assert.equal(kernel.snapshot().workUnits.unit!.status, "verifying");
  emit({ type: "VerificationStarted", attemptId: input.attemptId }); emit({ type: "EvidenceRecorded", attemptId: input.attemptId, referenceId: "host-proof" });
  const results = [{ criterionId: "criterion", status: "satisfied", evidenceRefs: ["host-proof"] }];
  emit({ type: "VerificationCompleted", attemptId: input.attemptId, results }); emit({ type: "GlobalTaskCompleted", results });
  assert.equal(kernel.snapshot().tasks.task!.status, "completed");
});

test("actors with colliding global identities cannot replace another provider", async () => {
  const registry = new ProviderRegistry(), first = new MockExecutionProvider(), second = new MockExecutionProvider();
  Object.defineProperty(second, "id", { value: "second-provider" }); second.actor.providerId = second.id;
  registry.register(first); registry.register(second);
  await registry.probe(first.id);
  assert.deepEqual(await registry.probe(second.id), { status: "unavailable", reason: "actor_id_conflict" });
  assert.equal(registry.actors().length, 1); assert.equal(registry.actors()[0]!.providerId, first.id);
});

test("newer probe wins when a previous request completes late", async () => {
  let release!: (value: ProviderAvailability) => void;
  const registry = new ProviderRegistry(), provider = new MockExecutionProvider();
  provider.probe = () => new Promise(resolve => { release = resolve; }); registry.register(provider);
  const stale = registry.probe(provider.id);
  provider.probe = async () => ({ status: "unavailable", reason: "offline" });
  await registry.probe(provider.id); release({ status: "available", capabilities: [] });
  assert.equal((await stale).status, "unavailable");
  assert.deepEqual(registry.availability(provider.id), { status: "unavailable", reason: "offline" });
  assert.equal(registry.actors().length, 0);
});
