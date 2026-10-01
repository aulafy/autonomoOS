/** Match Spanish names consistently, regardless of accents or letter case. */
export function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
