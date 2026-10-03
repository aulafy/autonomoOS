import type { ActorDescriptor, DispatchExecutionInput, DispatchReceipt, ExecutionProvider, PrepareExecutionInput, PreparedExecution, ProviderAvailability, ProviderExecutionRef, ProviderObservation } from "./types.js";

/** Test double only. Never registered automatically and never substitutes a real provider. */
export class MockExecutionProvider implements ExecutionProvider {
  readonly id = "test-provider";
  availability: ProviderAvailability = { status: "available", capabilities: ["test.run"] };
  actor: ActorDescriptor = { id: "test:actor", providerId: this.id, kind: "deterministic",
    capabilities: [{ capability: "test.run", confidence: 1 }],
    costProfile: { currency: "EUR", estimatedCost: 0 }, latencyProfile: { estimatedMs: 0 },
    trustProfile: { level: "restricted" }, privacyProfile: { locality: "local", dataResidency: ["local"] }, availability: "available" };
  dispatchCount = 0;
  private prepared = new Map<string, PrepareExecutionInput>();
  private receipts = new Map<string, DispatchReceipt>();
  private observations = new Map<string, ProviderObservation>();
  async probe(): Promise<ProviderAvailability> { return structuredClone(this.availability); }
  async listActors(): Promise<ActorDescriptor[]> { return [structuredClone(this.actor)]; }
  async prepare(input: PrepareExecutionInput): Promise<PreparedExecution> {
    if (this.availability.status !== "available" || input.actorId !== this.actor.id) return { status: "rejected", reason: "actor_unavailable" };
    if ([input.taskId, input.workUnitId, input.attemptId, input.objective, input.contextRef, input.authorizationRef, input.dispatchFingerprint].some(value => typeof value !== "string" || !value.trim()) || !Array.isArray(input.resourceRefs) || input.resourceRefs.some(value => typeof value !== "string" || !value)) return { status: "rejected", reason: "invalid_execution_input" };
    const handle = `test:${input.attemptId}`;
    const previous = this.prepared.get(handle);
    if (previous && JSON.stringify(previous) !== JSON.stringify(input)) return { status: "rejected", reason: "attempt_identity_conflict" };
    this.prepared.set(handle, structuredClone(input));
    return { status: "prepared", providerId: this.id, attemptId: input.attemptId, handle, dispatchFingerprint: input.dispatchFingerprint };
  }
  async dispatch(input: DispatchExecutionInput): Promise<DispatchReceipt> {
    const prepared = this.prepared.get(input.handle);
    if (!prepared || ["taskId", "workUnitId", "attemptId", "actorId", "dispatchFingerprint", "authorizationRef"].some(key => prepared[key as keyof PrepareExecutionInput] !== input[key as keyof DispatchExecutionInput])) return { status: "not-executed", reason: "prepared_scope_mismatch" };
    const previous = this.receipts.get(input.handle);
    if (previous) return structuredClone(previous);
    if (this.availability.status !== "available") return { status: "not-executed", reason: "provider_unavailable" };
    this.dispatchCount++;
    const ref = { provider: this.id, externalAttemptId: input.handle };
    const receipt: DispatchReceipt = { status: "dispatched", ref, observedAt: 100 };
    this.receipts.set(input.handle, receipt);
    this.observations.set(input.handle, { status: "running", observedAt: 100 });
    return structuredClone(receipt);
  }
  setObservation(ref: ProviderExecutionRef, observation: ProviderObservation): void {
    if (ref.provider !== this.id || !ref.externalAttemptId || !this.observations.has(ref.externalAttemptId)) throw new Error("UNKNOWN_TEST_EXECUTION");
    this.observations.set(ref.externalAttemptId, structuredClone(observation));
  }
  async observe(ref: ProviderExecutionRef): Promise<ProviderObservation> {
    if (ref.provider !== this.id) return { status: "unverifiable", observedAt: 100, reason: "provider_scope_mismatch" };
    const value = ref.externalAttemptId ? this.observations.get(ref.externalAttemptId) : undefined;
    return value ? structuredClone(value) : { status: "not-found", observedAt: 100, reason: "execution_not_found" };
  }
}
