import type { Observer } from "./observer.js";
import type { ObserverDescriptor } from "./observer-descriptor.js";
import type { ObserverRegistry } from "./observer-registry.js";
import { ObservationError } from "./errors.js";

export class InMemoryObserverRegistry implements ObserverRegistry {
  private readonly byId = new Map<string, { observer: Observer; descriptor: ObserverDescriptor }>();
  register(observer: Observer): void {
    const descriptor = structuredClone(observer.descriptor);
    if (!descriptor.id || !descriptor.implementation ||
      !["world", "filesystem", "provider", "sensor", "api", "human", "fixture", "custom"]
        .includes(descriptor.sourceType) ||
      !["same_executor", "same_process", "independent_local", "independent_external", "human"]
        .includes(descriptor.independence) ||
      !["weak", "moderate", "strong"].includes(descriptor.strength) ||
      typeof descriptor.authenticated !== "boolean" ||
      !descriptor.metadata || typeof descriptor.metadata !== "object") {
      throw new ObservationError("INVALID_OBSERVER_RESULT");
    }
    if (this.byId.has(descriptor.id)) throw new ObservationError("OBSERVER_ALREADY_REGISTERED", descriptor.id);
    this.byId.set(descriptor.id, { observer, descriptor });
  }
  get(id: string): Observer | null {
    const entry = this.byId.get(id);
    if (!entry) return null;
    return {
      descriptor: structuredClone(entry.descriptor),
      observe: (request, signal) => entry.observer.observe(request, signal)
    };
  }
}
