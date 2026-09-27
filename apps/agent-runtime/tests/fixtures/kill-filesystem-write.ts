import { EffectCoordinator } from "@agent-world/effects";
import { FilesystemObserver, FilesystemWorkspace, FilesystemWriteExecutor,
  expectedBytes } from "@agent-world/filesystem";
import { InMemoryObserverRegistry, ObservationPolicy } from "@agent-world/observation";
import { createDurableDomainStores, JournalKernel, ReplayClock,
  RuntimeDatabase } from "@agent-world/runtime-store-sqlite";
import { WorldRuntime } from "@agent-world/world-core";
import { createDemoControlPlane } from "../../src/demo-control-plane.js";

const [path, workspaceRoot, window] = process.argv.slice(2);
if (!path || !workspaceRoot || !window) throw new Error("CRASH_FIXTURE_ARGS_REQUIRED");
const clock = new ReplayClock();
const database = new RuntimeDatabase(path, clock.now);
const kernel = new JournalKernel(database, clock);
const stores = createDurableDomainStores(kernel);
await kernel.restore();
const filesystem = new FilesystemWorkspace(workspaceRoot, stores.resources);
const file = filesystem.registerFile({ relativePath: "hello.txt" });
const content = "Hello from Agent World OS";
if (window === "F") {
  const bytes = expectedBytes({ mode: "create", content });
  stores.tasks.create({ id: "t1", principalId: "astra", createdAt: clock.now() });
  stores.budgets.createBudget({ id: "b1", ownerPrincipalId: "astra", taskId: "t1",
    ceiling: { actions: "5", bytes: "1000" } });
  stores.budgets.reserve({ id: "r1", budgetId: "b1", principalId: "astra",
    taskId: "t1", effectId: "e1", amount: { actions: "1",
      bytes: String(bytes.bytes.length) } }, 1);
  const observers = new InMemoryObserverRegistry();
  const observer = new FilesystemObserver(filesystem, stores.resources, clock.now);
  observers.register(observer);
  const coordinator = new EffectCoordinator(stores.effects, stores.observations,
    observers, new ObservationPolicy(clock, stores.resources), stores.effectEvents, clock);
  const expectedPostcondition = { kind: "filesystem_write", resourceIds: [file.id],
    predicate: "hash" as const, expected: { sha256: bytes.sha256,
      byteLength: bytes.bytes.length }, metadata: { mode: "create" } };
  const created = coordinator.createEffect({ id: "e1", taskId: "t1", intentId: "i1",
    executionId: "x1", executorId: "filesystem-write", action: "file.write",
    parameters: { mode: "create", content }, expectedPostcondition,
    resourceIds: [file.id], budgetReservationIds: ["r1"],
    metadata: { riskClass: "R2", observationMaxAgeMs: 30000,
      budgetActualAmount: { actions: "1", bytes: String(bytes.bytes.length) } } });
  const prepared = coordinator.prepare(created.id, created.version);
  const dispatching = coordinator.startDispatch(prepared.id, prepared.version);
  const report = await new FilesystemWriteExecutor(filesystem).dispatch({ taskId: "t1",
    intentId: "i1", effectId: "e1", idempotencyKey: dispatching.idempotencyKey,
    resourceIds: [file.id], parameters: { mode: "create", content } },
  new AbortController().signal);
  if (report.kind !== "reported_success") throw new Error("FILE_WRITE_DID_NOT_SUCCEED");
  const reported = coordinator.recordDispatchResult(dispatching.id, dispatching.version, report);
  const observation = await observer.observe({ subject: { taskId: "t1", intentId: "i1",
    executionId: "x1", effectId: "e1", resourceIds: [file.id] },
    expectedPostcondition, context: { resourceIds: [file.id] } },
  new AbortController().signal);
  stores.observations.append(observation);
  coordinator.settleFromObservation(reported.id, reported.version, observation.id,
    { riskClass: "R2", maxAgeMs: 30000 });
  process.kill(process.pid, "SIGKILL");
}
const dieAt = (point: string) => {
  if (window === point) process.kill(process.pid, "SIGKILL");
};
const control = createDemoControlPlane(new WorldRuntime(), event =>
  database.appendRuntimeEvent(event), { kernel, stores, filesystem,
    beforePreparedDispatch: () => dieAt("A"),
    beforeExecutorDispatch: () => dieAt("B"),
    afterFilesystemMutation: () => dieAt("C"),
    afterExecutorResponse: () => dieAt("D"),
    afterObservationPersisted: () => dieAt("E") });
control.recoverOnStartup();
const objectId = await control.stageTrustedContent("t1", "astra", content,
  { confidentiality: "public", categories: [], jurisdictions: [],
    ownerPrincipalIds: [], releasable: true, metadata: {} });
await control.run({ id: "i1", actorId: "astra", action: "file.write",
  targetId: "hello.txt", parameters: { mode: "create", content },
  provenance: { source: "human" } }, "t1", "t1", undefined, undefined,
{ flowObjectIds: [objectId] });
throw new Error(`CRASH_BOUNDARY_NOT_REACHED:${window}`);
