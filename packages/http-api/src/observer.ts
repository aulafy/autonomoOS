import { randomUUID } from "node:crypto";
import type { EffectStore } from "@agent-world/effects";
import { postconditionHash, type Observation, type ObservationRequest,
  type Observer } from "@agent-world/observation";
import type { ResourceRegistry } from "@agent-world/resources";
import { ApiEndpointRegistry, LookupSchema, type CredentialProvider } from
  "./api-resource.js";
import { sendApiRequest } from "./transport.js";

export class HttpApiObserver implements Observer {
  readonly descriptor = { id: "restricted-http-observer",
    implementation: "independent provider idempotency lookup",
    sourceType: "api" as const, independence: "independent_external" as const,
    strength: "strong" as const, authenticated: true, metadata: {} };
  constructor(private readonly endpoints: ApiEndpointRegistry,
    private readonly credentials: CredentialProvider,
    private readonly effects: EffectStore,
    private readonly resources: ResourceRegistry,
    private readonly now: () => number = Date.now) {}

  async observe(request: ObservationRequest, signal: AbortSignal): Promise<Observation> {
    const expected = request.expectedPostcondition;
    const endpointId = request.subject.resourceIds[0];
    const base: Observation = { id: randomUUID(),
      subject: structuredClone(request.subject), observerId: this.descriptor.id,
      source: "api", status: "unknown", observedAt: this.now(),
      expectedPostcondition: structuredClone(expected),
      expectedPostconditionHash: postconditionHash(expected),
      observedResourceGenerations: endpointId && this.resources.get(endpointId)
        ? { [endpointId]: this.resources.get(endpointId)!.generation } : {},
      evidence: [], reason: "API_LOOKUP_UNAVAILABLE", metadata: {} };
    const effect = request.subject.effectId ? this.effects.get(request.subject.effectId) : null;
    if (!endpointId || request.subject.resourceIds.length !== 1 ||
      expected.kind !== "api_create_record" || !effect ||
      effect.resourceIds[0] !== endpointId) return base;
    try {
      const binding = this.endpoints.get(endpointId);
      const credential = this.credentials.getCredential(binding.credentialRef);
      if (!credential) return base;
      const response = await sendApiRequest(binding, "GET",
        `${binding.lookupPrefix}${effect.idempotencyKey}`,
        { Authorization: `Bearer ${credential}` }, undefined, signal);
      if (response.status !== 200 && response.status !== 404) return base;
      const parsed = LookupSchema.safeParse(JSON.parse(response.body));
      if (!parsed.success) return base;
      const value = parsed.data;
      if (value.status === "created" && response.status === 200 &&
        value.idempotencyKey === effect.idempotencyKey) {
        const wanted = expected.expected as { name?: string; value?: number };
        const match = value.name === wanted.name && value.value === wanted.value;
        return { ...base, status: match ? "confirmed" : "contradicted",
          evidence: [{ kind: "provider_receipt", reference: value.recordId,
            metadata: { idempotencyKey: value.idempotencyKey,
              name: value.name, value: value.value } }],
          reason: match ? "PROVIDER_RECORD_MATCH" : "PROVIDER_RECORD_MISMATCH" };
      }
      if (value.status === "absent" && response.status === 404 &&
        value.idempotencyKey === effect.idempotencyKey) {
        const certificate = { kind: "idempotency_key_never_processed" as const,
          idempotencyKey: effect.idempotencyKey, authority: value.authority,
          reference: value.reference };
        return { ...base, status: "contradicted",
          evidence: [{ kind: "provider_receipt", reference: value.reference,
            metadata: { certifiedAbsent: true } }],
          reason: "PROVIDER_CERTIFIED_ABSENCE", metadata: { certificate } };
      }
      return base;
    } catch { return base; }
  }
}
