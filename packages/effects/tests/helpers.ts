import { mintResourceId } from "@agent-world/resources";
import {
  InMemoryObservationStore, InMemoryObserverRegistry, ObservationPolicy,
  postconditionHash, type Observation, type ObserverDescriptor
} from "@agent-world/observation";
import {
  EffectCoordinator, InMemoryEffectEventSink, InMemoryEffectStore,
  type Clock, type CreateEffectInput
} from "../src/index.js";

export const resourceId = mintResourceId("world_place", "demo-office/meeting-room");
export const otherResourceId = mintResourceId("world_place", "demo-office/home-point");
export const expectedPostcondition = {
  kind: "agent_position", resourceIds: [resourceId], predicate: "position" as const,
  expected: { agent: "astra", at: resourceId }, metadata: {}
};
export const descriptor: ObserverDescriptor = {
  id: "world-observer", implementation: "test", sourceType: "world",
  independence: "independent_local", strength: "strong", authenticated: true,
  metadata: {}
};
export const baseInput: CreateEffectInput = {
  id: "effect-1", taskId: "task-1", sessionContractId: "contract-1",
  intentId: "intent-1", executionId: "execution-1", executorId: "world-executor",
  action: "goto", parameters: { destination: resourceId },
  expectedPostcondition, resourceIds: [resourceId],
  resourceFences: { [resourceId]: "41" },
  capabilityGrantIds: ["grant-1"], authorityLeaseIds: ["lease-1"],
  resourceLeaseIds: ["resource-lease-1"], budgetReservationIds: ["reservation-1"],
  policyDecisionId: "policy-1", metadata: { attemptLoggedAt: 100 }
};

export function fixture(observerDescriptor: ObserverDescriptor = descriptor) {
  let now = 100;
  const clock: Clock & { set(value: number): void } = {
    now: () => now, set: value => { now = value; }
  };
  const effects = new InMemoryEffectStore();
  const observations = new InMemoryObservationStore();
  const observers = new InMemoryObserverRegistry();
  observers.register({ descriptor: observerDescriptor, observe: async () => makeObservation() });
  const policy = new ObservationPolicy(clock);
  const events = new InMemoryEffectEventSink();
  const coordinator = new EffectCoordinator(effects, observations, observers, policy, events, clock);
  const reachDispatch = () => {
    coordinator.createEffect(baseInput);
    coordinator.prepare("effect-1", 1);
    return coordinator.startDispatch("effect-1", 2);
  };
  return { clock, effects, observations, observers, policy, events, coordinator, reachDispatch };
}

export function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: "obs-1", observerId: descriptor.id, source: "world", status: "confirmed",
    subject: { taskId: "task-1", intentId: "intent-1", executionId: "execution-1",
      effectId: "effect-1", resourceIds: [resourceId] },
    observedAt: 100, expectedPostcondition: structuredClone(expectedPostcondition),
    expectedPostconditionHash: postconditionHash(expectedPostcondition),
    observedResourceGenerations: {},
    evidence: [{ kind: "event", reference: "world-event-1", metadata: {} }],
    reason: "World state was independently read.", metadata: {}, ...overrides
  };
}
