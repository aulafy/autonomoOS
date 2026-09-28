import type { MorningBrief, WorkItem } from "./domain.js";

export interface CallPlan {
  status: "ready_for_review" | "identity_required";
  objective: string;
  questions: string[];
  nextAppointment: { title: string; startsAt: string; state: "confirmed" | "proposed" } | null;
}

/** A preparation note only: no number is dialed and no provider state changes. */
export function buildCallPlan(item: WorkItem, brief: MorningBrief): CallPlan {
  if (!item.contact) return {
    status: "identity_required",
    objective: "Verificar quién contacta y si existe un expediente antes de tratar la solicitud.",
    questions: ["Confirmar identidad por un procedimiento autorizado", "Comprobar si existe ficha o expediente", ...item.missingInformation],
    nextAppointment: null
  };
  const appointment = brief.appointments.find(candidate =>
    candidate.contactId === item.contact!.id &&
    Date.parse(candidate.startsAt) >= Date.parse(brief.generatedAt));
  return {
    status: "ready_for_review",
    objective: item.nextAction,
    questions: [...item.missingInformation],
    nextAppointment: appointment ? {
      title: appointment.title,
      startsAt: appointment.startsAt,
      state: appointment.state
    } : null
  };
}
