import { mintResourceId } from "@agent-world/resources";
import {
  postconditionHash,
  type Clock, type Observation, type ObservationRequest,
  type ObserverDescriptor, type ExpectedPostcondition
} from "../src/index.js";

export const room = mintResourceId("world_place", "demo-office/meeting-room");
export const home = mintResourceId("world_place", "demo-office/home-point");
export const subject = { taskId: "task-1", intentId: "intent-1",
  executionId: "execution-1", effectId: "effect-1", resourceIds: [room] };
export const expected: ExpectedPostcondition = {
  kind: "agent_position", resourceIds: [room], predicate: "position",
  expected: { agent: "astra", at: room }, metadata: { frame: "world" }
};
export const request: ObservationRequest = {
  subject, expectedPostcondition: expected, context: { resourceIds: [room] }
};
export const descriptor: ObserverDescriptor = {
  id: "world-observer", implementation: "test-fixture", sourceType: "world",
  independence: "independent_local", strength: "strong", authenticated: true,
  metadata: {}
};
export function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: "obs-1", subject: structuredClone(subject), observerId: descriptor.id,
    source: "world", status: "confirmed", observedAt: 100,
    expectedPostcondition: structuredClone(expected),
    expectedPostconditionHash: postconditionHash(expected),
    observedResourceGenerations: {},
    evidence: [{ kind: "event", reference: "world-event-1", metadata: {} }],
    reason: "World state shows Astra in the meeting room.", metadata: {},
    ...overrides
  };
}
export function fakeClock(initial = 100): Clock & { set(value: number): void } {
  let now = initial;
  return { now: () => now, set: value => { now = value; } };
}
