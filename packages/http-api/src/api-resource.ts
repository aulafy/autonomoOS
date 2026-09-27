import { createHash } from "node:crypto";
import { z } from "zod";
import { mintResourceId, type ResourceId, type ResourceRegistry } from
  "@agent-world/resources";

export const CreateRecordSchema = z.object({
  name: z.string().min(1).max(80).regex(/^[a-zA-Z0-9 _.-]+$/),
  value: z.number().int().safe()
}).strict();
export type CreateRecord = z.infer<typeof CreateRecordSchema>;
export const CreatedRecordSchema = CreateRecordSchema.extend({
  recordId: z.string().min(1).max(100),
  idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.literal("created")
}).strict();
export const LookupSchema = z.discriminatedUnion("status", [
  CreatedRecordSchema,
  z.object({ status: z.literal("absent"), processed: z.literal(false),
    certified: z.literal(true), idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
    authority: z.string().min(1), reference: z.string().min(1) }).strict(),
  z.object({ status: z.literal("not_found") }).strict()
]);

export interface ApiEndpointConfig {
  serviceName: string;
  origin: string;
  credentialRef: string;
  /** Only for the separate-process local test fixture. */
  allowFixtureLoopback?: boolean;
  /** Host-verified provider contract: a rejected 400 with processed=false has no effect. */
  certifiesRejectedNoEffect?: boolean;
  timeoutMs?: number;
}
export interface ApiEndpointBinding extends ApiEndpointConfig {
  serviceId: ResourceId;
  endpointId: ResourceId;
  createPath: "/items";
  lookupPrefix: "/items/by-idempotency-key/";
}

export class ApiEndpointRegistry {
  private readonly bindings = new Map<ResourceId, ApiEndpointBinding>();
  constructor(private readonly resources: ResourceRegistry) {}
  register(config: ApiEndpointConfig): ApiEndpointBinding {
    if (!/^[a-z][a-z0-9-]*$/.test(config.serviceName) ||
      !/^[a-z][a-z0-9-]*$/.test(config.credentialRef) ||
      (config.timeoutMs !== undefined &&
        (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 50 ||
          config.timeoutMs > 60000))) {
      throw new Error("INVALID_API_CONFIGURATION");
    }
    const url = new URL(config.origin);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      !["http:", "https:"].includes(url.protocol)) {
      throw new Error("INVALID_API_ORIGIN");
    }
    const serviceId = mintResourceId("service", config.serviceName);
    const endpointId = mintResourceId("endpoint", `${config.serviceName}/items-create`);
    const binding: ApiEndpointBinding = { ...config, origin: url.origin,
      serviceId, endpointId, createPath: "/items",
      lookupPrefix: "/items/by-idempotency-key/" };
    const bindingHash = createHash("sha256").update(JSON.stringify(binding)).digest("hex");
    if (!this.resources.has(serviceId)) this.resources.register({ id: serviceId,
      kind: "service", displayName: config.serviceName, aliases: [], parentId: null,
      dataLabel: null, exclusivity: "shared", sink: null, source: "host",
      metadata: { bindingHash } });
    const service = this.resources.get(serviceId);
    if (service?.source !== "host" || service.metadata.bindingHash !== bindingHash) {
      throw new Error("API_BINDING_CHANGED");
    }
    if (!this.resources.has(endpointId)) this.resources.register({ id: endpointId,
      kind: "endpoint", displayName: `${config.serviceName} create item`,
      aliases: [`${config.serviceName}.create_record`], parentId: serviceId,
      dataLabel: null, exclusivity: "shared", source: "host",
      sink: { external: true, trustClass: "external",
        allowedSensitivity: ["public", "internal"] },
      metadata: { bindingHash, method: "POST", path: "/items",
        requestSchema: "create-record-v1", responseSchema: "created-record-v1",
        credentialRef: config.credentialRef, idempotent: true, lookup: true } });
    const endpoint = this.resources.get(endpointId);
    if (endpoint?.source !== "host" || endpoint.kind !== "endpoint" ||
      endpoint.parentId !== serviceId || endpoint.metadata.bindingHash !== bindingHash ||
      endpoint.metadata.method !== "POST" || endpoint.metadata.path !== "/items") {
      throw new Error("API_BINDING_CHANGED");
    }
    this.bindings.set(endpointId, binding);
    return structuredClone(binding);
  }
  get(id: ResourceId): ApiEndpointBinding {
    const binding = this.bindings.get(id);
    const resource = this.resources.get(id);
    if (!binding || !resource || resource.kind !== "endpoint" ||
      resource.parentId !== binding.serviceId) throw new Error("ENDPOINT_NOT_REGISTERED");
    return structuredClone(binding);
  }
}

export interface CredentialProvider {
  getCredential(reference: string): string | null;
}
/** Host configuration maps one opaque reference to one environment variable. */
export class EnvironmentCredentialProvider implements CredentialProvider {
  constructor(private readonly names: Readonly<Record<string, string>>) {}
  getCredential(reference: string): string | null {
    const name = this.names[reference];
    return name ? process.env[name] ?? null : null;
  }
}
