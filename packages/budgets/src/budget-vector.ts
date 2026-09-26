import { BudgetError } from "./errors.js";

export type BudgetVector = Record<string, string>;
const DIMENSION_RE = /^[a-z][a-z0-9_]*(?::[A-Za-z0-9_]+)*$/;

export function parseQuantity(value: unknown): bigint {
  if (typeof value !== "string") throw new BudgetError("INVALID_BUDGET_QUANTITY");
  if (/^-\d+$/.test(value)) throw new BudgetError("NEGATIVE_BUDGET_QUANTITY");
  if (!/^\d+$/.test(value)) throw new BudgetError("INVALID_BUDGET_QUANTITY");
  return BigInt(value);
}

export function normalizeVector(input: BudgetVector): BudgetVector {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BudgetError("INVALID_BUDGET_VECTOR");
  }
  const result: BudgetVector = Object.create(null);
  for (const [dimension, value] of Object.entries(input)) {
    if (!DIMENSION_RE.test(dimension)) throw new BudgetError("INVALID_BUDGET_VECTOR", dimension);
    result[dimension] = parseQuantity(value).toString();
  }
  return result;
}

export function zeroVector(dimensions: readonly string[]): BudgetVector {
  const result: BudgetVector = Object.create(null);
  for (const dimension of dimensions) result[dimension] = "0";
  return result;
}

export function assertKnownDimensions(vector: BudgetVector, ceiling: BudgetVector): void {
  for (const dimension of Object.keys(vector)) {
    if (!Object.hasOwn(ceiling, dimension)) {
      throw new BudgetError("UNKNOWN_BUDGET_DIMENSION", dimension);
    }
  }
}

export function addVectors(left: BudgetVector, right: BudgetVector): BudgetVector {
  const a = normalizeVector(left);
  const b = normalizeVector(right);
  const result = zeroVector([...new Set([...Object.keys(a), ...Object.keys(b)])]);
  for (const dimension of Object.keys(result)) {
    result[dimension] = (BigInt(a[dimension] ?? "0") + BigInt(b[dimension] ?? "0")).toString();
  }
  return result;
}

export function subtractVectors(left: BudgetVector, right: BudgetVector): BudgetVector {
  const a = normalizeVector(left);
  const b = normalizeVector(right);
  const result = zeroVector([...new Set([...Object.keys(a), ...Object.keys(b)])]);
  for (const dimension of Object.keys(result)) {
    const difference = BigInt(a[dimension] ?? "0") - BigInt(b[dimension] ?? "0");
    if (difference < 0n) throw new BudgetError("INVARIANT_VIOLATION", dimension);
    result[dimension] = difference.toString();
  }
  return result;
}

export function fitsWithin(amount: BudgetVector, limit: BudgetVector): boolean {
  const a = normalizeVector(amount);
  const b = normalizeVector(limit);
  return Object.keys(a).every(dimension => BigInt(a[dimension]) <= BigInt(b[dimension] ?? "0"));
}

export function vectorsEqual(left: BudgetVector, right: BudgetVector): boolean {
  return fitsWithin(left, right) && fitsWithin(right, left);
}

export function isZeroVector(vector: BudgetVector): boolean {
  return Object.values(normalizeVector(vector)).every(value => value === "0");
}
