import type { ExecutorContext, SideEffectExecutor } from "@agent-world/control-plane";
import type { DispatchResult } from "@agent-world/effects";
import { ApiEndpointRegistry, CreateRecordSchema, CreatedRecordSchema,
  type CredentialProvider } from "./api-resource.js";
import { resolveDestination, sendApiRequest } from "./transport.js";

export class HttpApiExecutor implements SideEffectExecutor {
  readonly id = "restricted-http-api";
  constructor(private readonly endpoints: ApiEndpointRegistry,
    private readonly credentials: CredentialProvider,
    private readonly afterRequest?: () => void) {}

  async dispatch(context: ExecutorContext, signal: AbortSignal): Promise<DispatchResult> {
    let binding;
    let body: string;
    let token: string;
    let expected;
    try {
      if (context.resourceIds.length !== 1 ||
        !/^[a-f0-9]{64}$/.test(context.idempotencyKey)) {
        throw new Error("INVALID_API_EFFECT");
      }
      binding = this.endpoints.get(context.resourceIds[0]!);
      expected = CreateRecordSchema.parse(context.parameters);
      body = JSON.stringify(expected);
      token = this.credentials.getCredential(binding.credentialRef) ?? "";
      if (!token) throw new Error("API_CREDENTIAL_UNAVAILABLE");
      await resolveDestination(binding);
      if (signal.aborted) throw new Error("DISPATCH_ABORTED");
    } catch (error) {
      return { kind: "reported_failure", certainty: "certified_not_started",
        reason: error instanceof Error ? error.message : "INVALID_API_REQUEST", metadata: {} };
    }
    try {
      const response = await sendApiRequest(binding, "POST", binding.createPath,
        { "Content-Type": "application/json", "Authorization": `Bearer ${token}`,
          "Idempotency-Key": context.idempotencyKey }, body, signal);
      this.afterRequest?.();
      if (response.status === 201) {
        const parsed = CreatedRecordSchema.safeParse(JSON.parse(response.body));
        if (parsed.success && parsed.data.idempotencyKey === context.idempotencyKey &&
          parsed.data.name === expected.name && parsed.data.value === expected.value) {
          return { kind: "reported_success", externalReference: parsed.data.recordId,
            metadata: { requestBytes: Buffer.byteLength(body),
              responseBytes: response.byteLength } };
        }
      }
      if (response.status === 400 && binding.certifiesRejectedNoEffect === true) {
        let rejected: unknown;
        try { rejected = JSON.parse(response.body); } catch { rejected = null; }
        if (typeof rejected === "object" && rejected !== null &&
          (rejected as any).status === "rejected" &&
          (rejected as any).processed === false) {
          return { kind: "reported_failure", certainty: "certified_not_started",
            reason: "PROVIDER_REJECTED_BEFORE_PROCESSING",
            metadata: { requestBytes: Buffer.byteLength(body),
              responseBytes: response.byteLength } };
        }
      }
      return { kind: "unknown", reason: `API_RESPONSE_UNCERTAIN_${response.status}`,
        metadata: { requestBytes: Buffer.byteLength(body),
          responseBytes: response.byteLength } };
    } catch {
      this.afterRequest?.();
      // Once request transmission may have begun, even a timeout or reset is
      // uncertain. No POST retry is performed here or in reconciliation.
      return { kind: "unknown", reason: "API_RESPONSE_LOST_OR_MALFORMED",
        metadata: { requestBytes: Buffer.byteLength(body) } };
    }
  }
}
