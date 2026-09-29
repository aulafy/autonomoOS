export function normalizeRequestId(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length <= 200 ? normalized : crypto.randomUUID();
}
