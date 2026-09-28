import type { InsuranceLine } from "./config.js";

export type Channel = "whatsapp" | "telegram" | "imessage" | "email";
export type Topic = "incident" | "quote" | "renewal" | "appointment" | "service";
export type Priority = "urgent" | "high" | "normal";

export interface Contact {
  id: string;
  name: string;
  relationship: "client" | "prospect";
  owner: string;
  product: InsuranceLine | null;
}

export interface IncomingMessage {
  id: string;
  externalId: string;
  channel: Channel;
  contactId: string;
  receivedAt: string;
  text: string;
  topic: Topic;
  insuranceLine?: InsuranceLine;
  classificationSource: "demo_fixture" | "human" | "model";
  dueAt?: string;
}

export interface Appointment {
  id: string;
  contactId: string;
  startsAt: string;
  title: string;
  state: "confirmed" | "proposed";
}

export interface WorkItem {
  id: string;
  message: IncomingMessage;
  contact: Contact;
  priority: Priority;
  reason: string;
  nextAction: string;
  draft: string;
  missingInformation: string[];
  reviewRequired: true;
  executionStatus: "draft_only";
}

export interface MorningBrief {
  generatedAt: string;
  items: WorkItem[];
  appointments: Array<Appointment & { contactName: string }>;
  counts: { total: number; urgent: number; high: number;
    byChannel: Record<Channel, number> };
}

const priorityWeight: Record<Priority, number> = { urgent: 0, high: 1, normal: 2 };

function priorityFor(message: IncomingMessage, now: Date): { priority: Priority;
  reason: string } {
  if (message.topic === "incident") return {
    priority: "urgent", reason: "Incidencia comunicada: requiere revisión inmediata" };
  const due = message.dueAt ? new Date(message.dueAt).getTime() : NaN;
  const daysUntilDue = (due - now.getTime()) / 86_400_000;
  if (Number.isFinite(daysUntilDue) && daysUntilDue <= 2) return {
    priority: "high", reason: "Hay una fecha próxima que requiere respuesta" };
  if (message.topic === "renewal") return {
    priority: "high", reason: "Renovación que necesita seguimiento" };
  return { priority: "normal", reason: "Pendiente de preparación y revisión" };
}

const quoteInformation: Record<InsuranceLine, string[]> = {
  auto: ["Vehículo y uso", "Conductores habituales", "Coberturas deseadas", "Fecha de inicio"],
  life: ["Capital y finalidad", "Personas a asegurar", "Fecha de inicio", "Cuestionario de la aseguradora, por canal autorizado"],
  home: ["Vivienda y uso", "Capitales a asegurar", "Coberturas deseadas", "Fecha de inicio"],
  selfEmployedLiability: ["Actividad profesional", "Ámbito de cobertura", "Límites deseados", "Fecha de inicio"]
};

function preparation(topic: Topic, firstName: string, line?: InsuranceLine): Pick<WorkItem,
  "nextAction" | "draft" | "missingInformation"> {
  switch (topic) {
    case "incident": return {
      nextAction: "Abrir revisión de incidencia y preparar llamada",
      draft: `Hola ${firstName}, he recibido tu aviso. Voy a revisar la póliza y los datos del incidente para indicarte los siguientes pasos. Te confirmaré la información que falta antes de tramitar nada.`,
      missingInformation: ["Póliza afectada", "Fecha y lugar", "Documentación o fotografías"] };
    case "quote": return {
      nextAction: "Preparar recogida de datos para propuesta",
      draft: `Hola ${firstName}, gracias por contactar. Para preparar una propuesta adecuada necesito confirmar el riesgo, las coberturas que buscas y los datos necesarios. Después revisaré las opciones contigo.`,
      missingInformation: line ? quoteInformation[line] :
        ["Datos del riesgo", "Coberturas deseadas", "Fecha de inicio"] };
    case "renewal": return {
      nextAction: "Revisar condiciones y preparar llamada",
      draft: `Hola ${firstName}, he visto tu consulta sobre la renovación. Revisaré las condiciones vigentes y las alternativas disponibles antes de darte una respuesta concreta.`,
      missingInformation: ["Condiciones vigentes", "Fecha de vencimiento"] };
    case "appointment": return {
      nextAction: "Comprobar agenda y proponer horario",
      draft: `Hola ${firstName}, he recibido tu solicitud de cita. Voy a comprobar la agenda y te confirmaré una opción de horario.`,
      missingInformation: ["Disponibilidad del agente", "Horario preferido"] };
    case "service": return {
      nextAction: "Verificar solicitud en CRM antes de cambiar datos",
      draft: `Hola ${firstName}, he recibido tu solicitud. Verificaré los datos de tu expediente y te confirmaré el siguiente paso.`,
      missingInformation: ["Identidad y autorización", "Datos actuales del expediente"] };
  }
}

/** Read-only morning planning. No connector, send, quote, CRM or calendar mutation. */
export function buildMorningBrief(input: { contacts: readonly Contact[];
  messages: readonly IncomingMessage[]; appointments: readonly Appointment[];
  now: string }): MorningBrief {
  const now = new Date(input.now);
  if (Number.isNaN(now.getTime())) throw new Error("INVALID_BRIEF_TIME");
  const contacts = new Map(input.contacts.map(contact => [contact.id, contact]));
  const seen = new Set<string>();
  const items: WorkItem[] = [];
  for (const message of [...input.messages].sort((a, b) =>
    b.receivedAt.localeCompare(a.receivedAt))) {
    const key = `${message.channel}:${message.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const contact = contacts.get(message.contactId);
    if (!contact) throw new Error(`UNKNOWN_CONTACT:${message.contactId}`);
    if (Number.isNaN(new Date(message.receivedAt).getTime())) {
      throw new Error(`INVALID_MESSAGE_TIME:${message.id}`);
    }
    const firstName = contact.name.split(" ")[0] ?? contact.name;
    const priority = priorityFor(message, now);
    items.push({ id: message.id, message, contact, ...priority,
      ...preparation(message.topic, firstName, message.insuranceLine),
      reviewRequired: true, executionStatus: "draft_only" });
  }
  items.sort((a, b) => priorityWeight[a.priority] - priorityWeight[b.priority] ||
    b.message.receivedAt.localeCompare(a.message.receivedAt));
  const byChannel: Record<Channel, number> = {
    whatsapp: 0, telegram: 0, imessage: 0, email: 0 };
  for (const item of items) byChannel[item.message.channel]++;
  const appointments = input.appointments.map(appointment => ({ ...appointment,
    contactName: contacts.get(appointment.contactId)?.name ?? "Contacto pendiente" }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return { generatedAt: now.toISOString(), items, appointments,
    counts: { total: items.length,
      urgent: items.filter(item => item.priority === "urgent").length,
      high: items.filter(item => item.priority === "high").length,
      byChannel } };
}
