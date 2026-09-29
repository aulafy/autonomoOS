export function normalizeRequestId(value: string | null | undefined): string {
  return value && value.length <= 200 ? value : crypto.randomUUID();
}
