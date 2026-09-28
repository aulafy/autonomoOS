import type { Appointment, Contact, IncomingMessage } from "./domain.js";

export function makeDemoData(now = new Date()): {
  now: string; contacts: Contact[]; messages: IncomingMessage[];
  appointments: Appointment[] } {
  const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
  const contacts: Contact[] = [
    { id: "contact-lucia", name: "Lucía Moreno", relationship: "client",
      owner: "Agente", product: "auto" },
    { id: "contact-diego", name: "Diego Salas", relationship: "prospect",
      owner: "Agente", product: "home" },
    { id: "contact-marta", name: "Marta Ríos", relationship: "client",
      owner: "Agente", product: "selfEmployedLiability" },
    { id: "contact-alex", name: "Álex Vega", relationship: "client",
      owner: "Agente", product: "auto" },
    { id: "contact-noa", name: "Noa Ferrer", relationship: "prospect",
      owner: "Agente", product: "selfEmployedLiability" },
    { id: "contact-pablo", name: "Pablo Serra", relationship: "client",
      owner: "Agente", product: "home" },
    { id: "contact-irene", name: "Irene Campos", relationship: "prospect",
      owner: "Agente", product: "life" }
  ];
  const messages: IncomingMessage[] = [
    { id: "msg-1", externalId: "wa-101", channel: "whatsapp",
      contactId: "contact-lucia", receivedAt: at(-0.6), topic: "incident", insuranceLine: "auto",
      classificationSource: "demo_fixture",
      text: "Buenos días. He tenido un golpe con el coche y necesito saber cómo abrir el parte." },
    { id: "msg-2", externalId: "mail-202", channel: "email",
      contactId: "contact-diego", receivedAt: at(-1.4), topic: "quote", insuranceLine: "home",
      classificationSource: "demo_fixture",
      text: "Quiero comparar opciones de seguro de hogar para mi vivienda. ¿Qué datos necesitas?" },
    { id: "msg-3", externalId: "tg-303", channel: "telegram",
      contactId: "contact-marta", receivedAt: at(-2.1), dueAt: at(20),
      topic: "renewal", insuranceLine: "selfEmployedLiability", classificationSource: "demo_fixture",
      text: "Mi póliza de responsabilidad civil como autónoma vence pronto. ¿Revisamos las coberturas?" },
    { id: "msg-4", externalId: "im-404", channel: "imessage",
      contactId: "contact-alex", receivedAt: at(-2.8), dueAt: at(17),
      topic: "appointment", insuranceLine: "auto", classificationSource: "demo_fixture",
      text: "Mañana no puedo acudir a la cita. ¿Podemos buscar otro horario?" },
    { id: "msg-5", externalId: "wa-505", channel: "whatsapp",
      contactId: "contact-noa", receivedAt: at(-3.3), topic: "quote", insuranceLine: "selfEmployedLiability",
      classificationSource: "demo_fixture",
      text: "Soy autónoma y quiero una propuesta de responsabilidad civil para mi actividad." },
    { id: "msg-6", externalId: "mail-606", channel: "email",
      contactId: "contact-pablo", receivedAt: at(-4), topic: "service", insuranceLine: "home",
      classificationSource: "demo_fixture",
      text: "Necesito actualizar la dirección de correspondencia de mi expediente." },
    { id: "msg-7", externalId: "mail-707", channel: "email",
      contactId: "contact-irene", receivedAt: at(-4.5), topic: "quote", insuranceLine: "life",
      classificationSource: "demo_fixture",
      text: "Estoy valorando un seguro de vida. ¿Qué información necesitas para empezar?" },
    { id: "msg-1-duplicate", externalId: "wa-101", channel: "whatsapp",
      contactId: "contact-lucia", receivedAt: at(-0.7), topic: "incident", insuranceLine: "auto",
      classificationSource: "demo_fixture",
      text: "Duplicado técnico del mismo mensaje, no debe crear otra tarea." }
  ];
  const appointments: Appointment[] = [
    { id: "appt-1", contactId: "contact-diego", startsAt: at(2.5),
      title: "Llamada sobre seguro de hogar", state: "confirmed" },
    { id: "appt-2", contactId: "contact-alex", startsAt: at(17),
      title: "Revisión de póliza de auto", state: "confirmed" },
    { id: "appt-3", contactId: "contact-marta", startsAt: at(22),
      title: "Posible llamada de renovación", state: "proposed" }
  ];
  return { now: now.toISOString(), contacts, messages, appointments };
}
