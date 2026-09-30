export function retryDelayMs(value: string | undefined): number {
  if (!value) return 5000;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(60000, Math.max(1000, Math.round(seconds * 1000)));
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.min(60000, Math.max(1000, date - Date.now()));
  return 5000;
}
