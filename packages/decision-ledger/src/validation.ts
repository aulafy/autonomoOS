import { createHash } from "node:crypto";
import type { ActorRef, RecordProvenance } from "./types.js";
export const recordId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);
export const recordTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
export function recordCheck(condition: unknown): void { if (!condition) throw new Error("INVALID_RECORD"); }
export function recordKeys(value: unknown, allowed: string[]): void { recordCheck(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key))); }
export function canonicalRecord(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalRecord).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([key,item]) => `${JSON.stringify(key)}:${canonicalRecord(item)}`).join(",")}}`;
  recordCheck(value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value));
  return JSON.stringify(value);
}
export function recordDigest(value: unknown): string { return `sha256:${createHash("sha256").update(canonicalRecord(value)).digest("hex")}`; }
export function validateActorRef(value: ActorRef): void {
  recordKeys(value,["id","kind","providerId"]); recordCheck(recordId(value.id) && ["host","human","actor"].includes(value.kind));
  if (value.providerId !== undefined) recordCheck(recordId(value.providerId));
}
export function validateProvenance(values: RecordProvenance[], createdAt: number): void {
  recordCheck(Array.isArray(values) && values.length > 0);
  for (const value of values) {
    recordKeys(value,["sourceRef","sourceDigest","dataObjectId","operation","actor","createdAt"]);
    recordCheck(recordId(value.sourceRef) && recordTimestamp(value.createdAt) && value.createdAt <= createdAt && ["created","derived","observed","imported"].includes(value.operation));
    if (value.sourceDigest !== undefined) recordCheck(/^sha256:[a-f0-9]{64}$/.test(value.sourceDigest));
    if (value.dataObjectId !== undefined) recordCheck(recordId(value.dataObjectId));
    validateActorRef(value.actor);
  }
}
