export const pilotConfig = {
  country: "España",
  timeZone: "Europe/Madrid",
  crm: { name: "Holded", status: "por conectar" },
  calendar: { name: "Google Calendar", status: "por conectar" },
  channels: ["whatsapp", "telegram", "imessage", "email"] as const
} as const;

export const insuranceLines = {
  auto: "Coche",
  life: "Vida",
  home: "Hogar",
  selfEmployedLiability: "Responsabilidad civil · autónomos"
} as const;

export type InsuranceLine = keyof typeof insuranceLines;
