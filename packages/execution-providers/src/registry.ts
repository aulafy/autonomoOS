import type { ActorDescriptor, ExecutionProvider, ProviderAvailability } from "./types.js";
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
const check = (ok: unknown): void => { if (!ok) throw new Error("MALFORMED_PROVIDER_METADATA"); };
function validateAvailability(value: ProviderAvailability): void {
  check(value && ["available", "degraded", "unavailable"].includes(value.status));
  if (value.status === "available" && value.version !== undefined) check(typeof value.version === "string" && value.version.length > 0 && value.version.length <= 200);
  if (value.status !== "available") check(typeof value.reason === "string" && value.reason.length > 0 && value.reason.length <= 500);
  if (value.status !== "unavailable") {
    check(Array.isArray(value.capabilities) && value.capabilities.every(validId));
    check(new Set(value.capabilities).size === value.capabilities.length);
  }
}
export function validateActorDescriptor(value: ActorDescriptor, providerId: string): void {
  check(value && validId(value.id) && value.providerId === providerId);
  check(["llm", "coding-agent", "browser-agent", "computer-agent", "api", "deterministic", "human"].includes(value.kind));
  check(["available", "degraded", "unavailable"].includes(value.availability));
  check(Array.isArray(value.capabilities));
  check(new Set(value.capabilities.map(capability => capability.capability)).size === value.capabilities.length);
  for (const capability of value.capabilities) {
    check(validId(capability.capability) && Number.isFinite(capability.confidence) && capability.confidence >= 0 && capability.confidence <= 1);
    if (capability.constraints) check(Array.isArray(capability.constraints) && capability.constraints.every(constraint => validId(constraint.id) && validId(constraint.ruleRef)));
  }
  const numeric = (number: unknown) => number === null || (typeof number === "number" && Number.isFinite(number) && number >= 0);
  check(value.costProfile && typeof value.costProfile.currency === "string" && value.costProfile.currency.length > 0 && numeric(value.costProfile.estimatedCost));
  check(value.latencyProfile && numeric(value.latencyProfile.estimatedMs));
  check(value.trustProfile && ["untrusted", "restricted", "trusted"].includes(value.trustProfile.level));
  check(value.privacyProfile && ["local", "remote"].includes(value.privacyProfile.locality) && Array.isArray(value.privacyProfile.dataResidency) && value.privacyProfile.dataResidency.every(validId));
}
interface Entry { provider: ExecutionProvider; epoch: number; availability: ProviderAvailability; actors: ActorDescriptor[] }
export class ProviderRegistry {
  private entries = new Map<string, Entry>();
  constructor(private timeoutMs = 5000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error("INVALID_PROBE_TIMEOUT");
  }
  register(provider: ExecutionProvider): void {
    if (!validId(provider.id) || this.entries.has(provider.id) || ["probe", "listActors", "prepare", "dispatch", "observe"].some(key => typeof (provider as unknown as Record<string, unknown>)[key] !== "function")) throw new Error("INVALID_PROVIDER_REGISTRATION");
    this.entries.set(provider.id, { provider, epoch: 0, actors: [], availability: { status: "unavailable", reason: "not_probed" } });
  }
  unregister(id: string): boolean { return this.entries.delete(id); }
  get(id: string): ExecutionProvider | undefined { return this.entries.get(id)?.provider; }
  availability(id: string): ProviderAvailability | undefined { const value = this.entries.get(id)?.availability; return value ? structuredClone(value) : undefined; }
  actors(): ActorDescriptor[] {
    return [...this.entries.values()].flatMap(entry => entry.availability.status === "available"
      ? entry.actors.filter(actor => actor.availability === "available") : [])
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(actor => structuredClone(actor));
  }
  async probe(id: string): Promise<ProviderAvailability> {
    const entry = this.entries.get(id); if (!entry) throw new Error("PROVIDER_NOT_REGISTERED");
    const epoch = ++entry.epoch;
    entry.actors = []; entry.availability = { status: "unavailable", reason: "probing" };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("provider_probe_timeout")), this.timeoutMs); });
    let availability: ProviderAvailability, actors: ActorDescriptor[] = [];
    try {
      const result = await Promise.race([(async () => {
        const availability = await entry.provider.probe(); validateAvailability(availability);
        const actors = availability.status === "available" ? await entry.provider.listActors() : [];
        check(Array.isArray(actors)); actors.forEach(actor => validateActorDescriptor(actor, id));
        check(new Set(actors.map(actor => actor.id)).size === actors.length);
        return { availability: structuredClone(availability), actors: structuredClone(actors) };
      })(), expired]);
      availability = result.availability; actors = result.actors;
    } catch (error) {
      availability = { status: "unavailable", reason: error instanceof Error && error.message === "provider_probe_timeout" ? "provider_probe_timeout" : error instanceof Error && error.message === "MALFORMED_PROVIDER_METADATA" ? "malformed_provider_metadata" : "provider_probe_failed" };
    } finally { if (timer) clearTimeout(timer); }
    if (this.entries.get(id) !== entry || entry.epoch !== epoch) return { status: "unavailable", reason: "stale_probe" };
    const otherIds = new Set([...this.entries.values()].filter(other => other !== entry).flatMap(other => other.actors.map(actor => actor.id)));
    if (actors.some(actor => otherIds.has(actor.id))) { availability = { status: "unavailable", reason: "actor_id_conflict" }; actors = []; }
    entry.availability = availability; entry.actors = actors;
    return structuredClone(availability);
  }
  async probeAll(): Promise<Record<string, ProviderAvailability>> {
    const pairs = await Promise.all([...this.entries.keys()].map(async id => [id, await this.probe(id)] as const));
    return Object.fromEntries(pairs);
  }
}
