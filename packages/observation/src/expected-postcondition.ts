import { createHash } from "node:crypto";
import { isCanonicalResourceId, type ResourceId } from "@agent-world/resources";

export type PostconditionPredicate = "equals" | "exists" | "not_exists" | "contains" |
  "state" | "position" | "hash" | "provider_status" | "custom";
export interface ExpectedPostcondition {
  kind: string;
  resourceIds: ResourceId[];
  predicate: PostconditionPredicate;
  expected: unknown;
  metadata: Record<string, unknown>;
}

function canonicalJson(value: unknown, ancestors = new WeakSet<object>()): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error("INVALID_POSTCONDITION");
    ancestors.add(value);
    const encoded = `[${value.map(item => canonicalJson(item, ancestors)).join(",")}]`;
    ancestors.delete(value);
    return encoded;
  }
  if (typeof value === "object") {
    if (ancestors.has(value)) throw new Error("INVALID_POSTCONDITION");
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new Error("INVALID_POSTCONDITION");
    }
    ancestors.add(value);
    const object = value as Record<string, unknown>;
    const encoded = `{${Object.keys(object).sort().map(key =>
      `${JSON.stringify(key)}:${canonicalJson(object[key], ancestors)}`).join(",")}}`;
    ancestors.delete(value);
    return encoded;
  }
  throw new Error("INVALID_POSTCONDITION");
}

export function postconditionHash(postcondition: ExpectedPostcondition): string {
  if (!postcondition || !postcondition.kind ||
    !["equals", "exists", "not_exists", "contains", "state", "position", "hash",
      "provider_status", "custom"].includes(postcondition.predicate) ||
    !Array.isArray(postcondition.resourceIds) ||
    postcondition.resourceIds.some(id => !isCanonicalResourceId(id)) ||
    !postcondition.metadata || typeof postcondition.metadata !== "object" ||
    Array.isArray(postcondition.metadata)) {
    throw new Error("INVALID_POSTCONDITION");
  }
  return createHash("sha256").update(canonicalJson(postcondition)).digest("hex");
}
