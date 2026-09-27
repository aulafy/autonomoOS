import { writeFileSync } from "node:fs";
import { EffectCoordinator } from "@agent-world/effects";
import { InMemoryObserverRegistry, ObservationPolicy, postconditionHash } from
  "@agent-world/observation";
import { mintResourceId } from "@agent-world/resources";
import { createDurableDomainStores, JournalKernel, ReplayClock,
  RuntimeDatabase } from "../../src/index.js";

const [path, window, externalMarker] = process.argv.slice(2);
if (!path || !window || !externalMarker) throw new Error("CRASH_FIXTURE_ARGS_REQUIRED");
const clock = new ReplayClock(() => 100);
const database = new RuntimeDatabase(path, clock.now);
const kernel = new JournalKernel(database, clock);
const stores = createDurableDomainStores(kernel);
await kernel.restore();
const resourceId = mintResourceId("world_place", "demo/room");
stores.resources.register({ id: resourceId, kind: "world_place", displayName: "Room",
  aliases: [], parentId: null, dataLabel: null, exclusivity: "shared",
  source: "host", sink: null });
stores.tasks.create({ id: "t1", principalId: "astra", createdAt: 100 });
stores.budgets.createBudget({ id: "b1", ownerPrincipalId: "astra", taskId: "t1",
  ceiling: { actions: "5" } });
const reservation = stores.budgets.reserve({ id: "r1", budgetId: "b1",
  principalId: "astra", taskId: "t1", effectId: "e1",
  amount: { actions: "1" }, expiresAt: 120 }, 1);
const die = () => process.kill(process.pid, "SIGKILL");
if (window === "A") die();
const observers = new InMemoryObserverRegistry();
observers.register({ descriptor: { id: "observer", implementation: "fixture",
  sourceType: "world", independence: "independent_local", strength: "strong",
  authenticated: true, metadata: {} }, observe: async () => {
    throw new Error("NO_LIVE_OBSERVATION_IN_FIXTURE");
  } });
const coordinator = new EffectCoordinator(stores.effects, stores.observations,
  observers, new ObservationPolicy(clock), stores.effectEvents, clock);
const postcondition = { kind: "world_position", resourceIds: [resourceId],
  predicate: "position" as const, expected: { at: resourceId }, metadata: {} };
const created = coordinator.createEffect({ id: "e1", taskId: "t1", intentId: "i1",
  executionId: "x1", executorId: "executor", action: "goto", parameters: {},
  expectedPostcondition: postcondition, resourceIds: [resourceId],
  budgetReservationIds: [reservation.id], metadata: { riskClass: "R1",
    observationMaxAgeMs: 100, budgetActualAmount: { actions: "1" } } });
const prepared = coordinator.prepare(created.id, created.version);
stores.tasks.addRequiredEffect("t1", "e1", 1);
if (window === "B") die();
const dispatching = kernel.transaction(() => {
  const effect = coordinator.startDispatch(prepared.id, prepared.version);
  database.appendRuntimeEvent({ id: "dispatch:e1", timestamp: 100,
    type: "effect.dispatching", effectId: "e1" });
  return effect;
});
if (window === "C") die();
writeFileSync(externalMarker, "one-attempt\n");
if (window === "D") die();
const reported = coordinator.recordDispatchResult(dispatching.id, dispatching.version,
  { kind: "reported_success", metadata: {} });
if (window === "E") die();
const observation = stores.observations.append({ id: "o1", observerId: "observer",
  source: "world", status: "confirmed", observedAt: 100,
  subject: { taskId: "t1", intentId: "i1", executionId: "x1",
    effectId: "e1", resourceIds: [resourceId] },
  expectedPostcondition: postcondition,
  expectedPostconditionHash: postconditionHash(postcondition),
  observedResourceGenerations: {}, evidence: [{ kind: "event",
    reference: externalMarker, metadata: {} }], reason: "confirmed", metadata: {} });
if (window === "F") die();
coordinator.settleFromObservation(reported.id, reported.version, observation.id,
  { riskClass: "R1", maxAgeMs: 100 });
if (window === "G") die();
stores.budgets.commitReservation("r1", { principalId: "astra", taskId: "t1" },
  { actions: "1" }, stores.budgets.getReservation("r1")!.version);
if (window === "H") die();
throw new Error(`UNKNOWN_CRASH_WINDOW:${window}`);
