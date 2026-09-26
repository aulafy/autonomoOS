// Canonical JSON for semantic effect inputs. Unsupported values and cycles fail closed.
export function stableJson(value: unknown): string {
  return encode(value, new WeakSet<object>());
}

function encode(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error("INVALID_STABLE_JSON");
    ancestors.add(value);
    const output = `[${value.map(item => encode(item, ancestors)).join(",")}]`;
    ancestors.delete(value);
    return output;
  }
  if (typeof value === "object") {
    if (ancestors.has(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
      throw new Error("INVALID_STABLE_JSON");
    }
    ancestors.add(value);
    const object = value as Record<string, unknown>;
    const output = `{${Object.keys(object).sort().map(key =>
      `${JSON.stringify(key)}:${encode(object[key], ancestors)}`).join(",")}}`;
    ancestors.delete(value);
    return output;
  }
  throw new Error("INVALID_STABLE_JSON");
}
