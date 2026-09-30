import type { Channel } from "./domain.js";

export const supportedChannels = ["whatsapp", "telegram", "imessage", "email"] as const satisfies readonly Channel[];
export type SupportedChannel = Channel;

export function parseCorsOrigins(value: string | undefined): string[] {
  const configured = value?.trim() ? value : "http://127.0.0.1:5174,http://localhost:5174";
  const origins = configured.split(",").map(item => item.trim()).filter(Boolean);
  if (origins.includes("*")) throw new Error("INVALID_PYMES_API_CORS_ORIGINS");
  return [...new Set(origins)];
}

export function parseConfiguredChannels(value: string | undefined): Set<SupportedChannel> {
  const allowed = new Set<SupportedChannel>(supportedChannels);
  const configured = value?.trim() ? value : supportedChannels.join(",");
  return new Set(configured.split(",").map(item => item.trim()).filter((item): item is SupportedChannel => allowed.has(item as SupportedChannel)));
}

export const pilotConfig = {
  country: "España",
  timeZone: "Europe/Madrid",
  crm: { name: "Holded", status: "por conectar" },
  calendar: { name: "Google Calendar", status: "por conectar" },
  channels: supportedChannels
} as const;

export const insuranceLines = {
  auto: "Coche",
  life: "Vida",
  home: "Hogar",
  selfEmployedLiability: "Responsabilidad civil · autónomos"
} as const;

export type InsuranceLine = keyof typeof insuranceLines;
