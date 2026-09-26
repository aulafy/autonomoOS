import type { ResourceId } from "@agent-world/resources";
import type { ExpectedPostcondition } from "./expected-postcondition.js";
import type { Observation } from "./observation.js";
import type { ObservationSubject } from "./observation-subject.js";
import type { ObserverDescriptor } from "./observer-descriptor.js";

export interface ObservationRequest {
  subject: ObservationSubject;
  expectedPostcondition: ExpectedPostcondition;
  context: { resourceIds: ResourceId[]; externalReference?: string };
}
export interface Observer {
  readonly descriptor: ObserverDescriptor;
  observe(request: ObservationRequest, signal: AbortSignal): Promise<Observation>;
}
