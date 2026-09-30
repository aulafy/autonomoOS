import type { Channel } from "./domain.js";

export const supportedChannels = ["whatsapp", "telegram", "imessage", "email"] as const satisfies readonly Channel[];
export type SupportedChannel = Channel;
export const connectorStatuses = ["lectura preparada", "conectado", "no configurado"] as const;
export type ConnectorStatus = typeof connectorStatuses[number];
export type ConnectorConfig = { id: string; name: string; status: ConnectorStatus };

export function normalizeBootstrapToken(value: string | undefined): string {
  const token = value?.trim() ?? "";
  if (token.length < 16 || token.length > 4096) throw new Error("PYMES_API_BOOTSTRAP_TOKEN_REQUIRED");
  return token;
}

export function normalizeOptionalToken(value: string | undefined, errorCode: string): string | undefined {
  const token = value?.trim() || undefined;
  if (token !== undefined && (token.length < 16 || token.length > 4096)) throw new Error(errorCode);
  return token;
}

export function normalizeBootstrapIdentity(value: string | undefined, fallback: string): string {
  const identity = (value ?? fallback).trim();
  if (!identity || identity.length > 200) throw new Error("INVALID_PYMES_API_BOOTSTRAP_IDENTITY");
  return identity;
}

export function parseConfiguredIdSet(value: string | undefined, errorCode = "INVALID_PYMES_ID_LIST"): Set<string> {
  const entries = (value ?? "").split(",").map(item => item.trim()).filter(Boolean);
  if (entries.length > 100 || entries.some(item => item.length > 200 || /[\u0000-\u001f\u007f]/.test(item))) throw new Error(errorCode);
  return new Set(entries);
}

/** Missing/blank input uses safe local defaults; wildcard input is rejected. */
export function parseCorsOrigins(value: string | undefined): string[] {
  const configured = value?.trim() ? value : "http://127.0.0.1:5174,http://localhost:5174";
  const rawOrigins = configured.split(",").map(item => item.trim()).filter(Boolean);
  const origins = rawOrigins.map(origin => {
    if (origin.length > 2_048) throw new Error("INVALID_PYMES_API_CORS_ORIGINS");
    let parsed: URL;
    try { parsed = new URL(origin); } catch { throw new Error("INVALID_PYMES_API_CORS_ORIGINS"); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      throw new Error("INVALID_PYMES_API_CORS_ORIGINS");
    }
    return parsed.origin;
  });
  if (origins.length === 0) return parseCorsOrigins(undefined);
  if (origins.includes("*")) throw new Error("INVALID_PYMES_API_CORS_ORIGINS");
  return [...new Set(origins)];
}

/** Missing/blank input uses supported channels; explicit unknown values are removed. */
export function parseConfiguredChannels(value: string | undefined): Set<SupportedChannel> {
  const allowed = new Set<SupportedChannel>(supportedChannels);
  const configured = value?.trim() ? value : supportedChannels.join(",");
  return new Set(configured.split(",").map(item => item.trim()).filter((item): item is SupportedChannel => allowed.has(item as SupportedChannel)));
}

export const pilotConfig = {
  country: "España",
  timeZone: "Europe/Madrid",
  crm: { id: "holded", name: "Holded", status: "lectura preparada" } satisfies ConnectorConfig,
  calendar: { id: "google_calendar", name: "Google Calendar", status: "lectura preparada" } satisfies ConnectorConfig,
  channels: supportedChannels
} as const;

export const insuranceLines = {
  auto: "Coche",
  life: "Vida",
  home: "Hogar",
  selfEmployedLiability: "Responsabilidad civil · autónomos"
} as const;

export type InsuranceLine = keyof typeof insuranceLines;
