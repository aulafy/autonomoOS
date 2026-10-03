import { createHash } from "node:crypto";
export function canonicalContext(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalContext).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,item]) => `${JSON.stringify(key)}:${canonicalContext(item)}`).join(",")}}`;
  if (!(value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value))) throw new Error("INVALID_CONTEXT_VALUE");
  return JSON.stringify(value);
}
export function contextDigest(value: unknown): string { return createHash("sha256").update(canonicalContext(value)).digest("hex"); }
export const validContextId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
