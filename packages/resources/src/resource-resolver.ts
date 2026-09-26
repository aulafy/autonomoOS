import type { ResourceKind } from "./kinds.js";
import { looksLikeResourceIdSyntax, parseResourceId, type ResourceId } from "./resource-id.js";
import type { ResourceRecord } from "./resource.js";
import type { ResourceRegistry } from "./resource-registry.js";

export function normalizeAlias(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

export type ResourceResolutionFailureReason = "EMPTY" | "INVALID_ID" | "NOT_REGISTERED" |
  "NOT_FOUND" | "AMBIGUOUS" | "KIND_MISMATCH";
export type ResourceResolution =
  | { ok: true; resource: ResourceRecord; via: "canonical_id" | "alias" }
  | { ok: false; reason: ResourceResolutionFailureReason; input: string; candidates?: ResourceId[] };
export interface ResolveResourceOptions { expectedKinds?: ResourceKind[] }

export class ResourceResolver {
  constructor(private readonly registry: ResourceRegistry) {}

  resolve(rawInput: string, options: ResolveResourceOptions = {}): ResourceResolution {
    const input = rawInput.trim();
    if (!input) return { ok: false, reason: "EMPTY", input: rawInput };
    if (looksLikeResourceIdSyntax(input)) {
      let id: ResourceId;
      try { id = parseResourceId(input); }
      catch { return { ok: false, reason: "INVALID_ID", input }; }
      const resource = this.registry.get(id);
      if (!resource) return { ok: false, reason: "NOT_REGISTERED", input };
      if (options.expectedKinds && !options.expectedKinds.includes(resource.kind)) {
        return { ok: false, reason: "KIND_MISMATCH", input, candidates: [id] };
      }
      return { ok: true, resource, via: "canonical_id" };
    }
    const matches = this.registry.findByAlias(input).filter(resource =>
      !options.expectedKinds || options.expectedKinds.includes(resource.kind)
    );
    if (matches.length === 0) return { ok: false, reason: "NOT_FOUND", input };
    if (matches.length > 1) {
      return { ok: false, reason: "AMBIGUOUS", input, candidates: matches.map(match => match.id) };
    }
    return { ok: true, resource: matches[0], via: "alias" };
  }
}
