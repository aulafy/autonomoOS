import { createGoogleCalendarEvent, sendMessageWebhook, sendWhatsAppCloudMessage } from "./connectors.js";
import type { EffectHandler } from "./effect-dispatcher.js";

/** Builds the server-side message sender. Meta is selected only when fully configured. */
export function createConfiguredMessageSender(input: {
  gatewayEndpoint?: string; gatewayToken?: string;
  whatsappAccessToken?: string; whatsappPhoneNumberId?: string; whatsappApiVersion?: string;
  timeoutMs?: number; fetcher?: typeof fetch;
}): Parameters<typeof messageEffectHandler>[0]["send"] {
  return async message => {
    if (message.channel === "whatsapp" && input.whatsappAccessToken?.trim() && input.whatsappPhoneNumberId?.trim()) {
      return sendWhatsAppCloudMessage({ accessToken: input.whatsappAccessToken, phoneNumberId: input.whatsappPhoneNumberId, to: message.contactId ?? "", text: message.text, apiVersion: input.whatsappApiVersion, timeoutMs: input.timeoutMs, fetcher: input.fetcher, idempotencyKey: message.idempotencyKey });
    }
    if (!input.gatewayEndpoint || !input.gatewayToken) throw new Error("MESSAGE_PROVIDER_NOT_CONFIGURED");
    return sendMessageWebhook({ endpoint: input.gatewayEndpoint, token: input.gatewayToken, channel: message.channel, text: message.text, contactId: message.contactId, timeoutMs: input.timeoutMs, fetcher: input.fetcher, idempotencyKey: message.idempotencyKey });
  };
}

export function messageEffectHandler(input: {
  send: (message: { channel: "whatsapp" | "telegram" | "imessage" | "email"; text: string; contactId?: string; idempotencyKey?: string }) => Promise<{ externalId: string }>;
}): EffectHandler {
  return {
    async execute(effect, context) {
      const payload = effect.payload;
      if ((payload.channel !== "whatsapp" && payload.channel !== "telegram" && payload.channel !== "imessage" && payload.channel !== "email") || typeof payload.text !== "string" || !payload.text.trim() || payload.text.length > 4_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(payload.text)) {
        throw new Error("INVALID_MESSAGE_EFFECT_PAYLOAD");
      }
      const result = await input.send({ channel: payload.channel, text: payload.text, contactId: typeof payload.contactId === "string" ? payload.contactId : undefined, idempotencyKey: context.idempotencyKey });
      if (!result || typeof result.externalId !== "string" || !result.externalId.trim() || result.externalId.length > 200) throw new Error("INVALID_MESSAGE_PROVIDER_RESPONSE");
      return `Message sent via ${payload.channel}: ${result.externalId}`;
    },
  };
}

export function crmTaskEffectHandler(input: {
  create: (task: { title: string; contactId: string; dueAt?: string; notes?: string }) => Promise<{ externalId: string }>;
}): EffectHandler {
  return {
    async execute(effect, context) {
      const payload = effect.payload;
      if (typeof payload.title !== "string" || !payload.title.trim() || payload.title.length > 500 || typeof payload.contactId !== "string" || !payload.contactId.trim() || payload.contactId.length > 200 || (payload.dueAt !== undefined && (typeof payload.dueAt !== "string" || Number.isNaN(Date.parse(payload.dueAt))))) {
        throw new Error("INVALID_CRM_TASK_EFFECT_PAYLOAD");
      }
      const result = await input.create({ title: payload.title.trim(), contactId: payload.contactId.trim(), dueAt: typeof payload.dueAt === "string" ? payload.dueAt : undefined, notes: `${typeof payload.notes === "string" ? payload.notes.slice(0, 3_800) : ""}\nIdempotency: ${context.idempotencyKey}`.trim() });
      if (!result || typeof result.externalId !== "string" || !result.externalId.trim() || result.externalId.length > 200) throw new Error("INVALID_CRM_PROVIDER_RESPONSE");
      return `CRM task created: ${result.externalId}`;
    },
  };
}

export function callEffectHandler(input: {
  start: (call: { phone?: string; objective?: string; questions?: string[]; contactId?: string; idempotencyKey?: string }) => Promise<{ externalId: string }>;
}): EffectHandler {
  return {
    async execute(effect, context) {
      const payload = effect.payload;
      const objective = typeof payload.objective === "string" && payload.objective.trim() ? payload.objective.trim() : undefined;
      const phone = typeof payload.phone === "string" && payload.phone.trim() ? payload.phone.trim() : undefined;
      const questions = Array.isArray(payload.questions) && payload.questions.every(value => typeof value === "string" && value.trim() && value.length <= 500) ? payload.questions as string[] : undefined;
      if (!objective && !phone) throw new Error("INVALID_CALL_EFFECT_PAYLOAD");
      if (payload.questions !== undefined && !questions) throw new Error("INVALID_CALL_EFFECT_PAYLOAD");
      const result = await input.start({ phone, objective, questions, contactId: typeof payload.contactId === "string" ? payload.contactId : undefined, idempotencyKey: context.idempotencyKey });
      if (!result || typeof result.externalId !== "string" || !result.externalId.trim() || result.externalId.length > 200) throw new Error("INVALID_CALL_PROVIDER_RESPONSE");
      return `Call started: ${result.externalId}`;
    },
  };
}

export function googleCalendarEffectHandler(input: {
  accessToken: string;
  calendarId: string;
  timeoutMs?: number;
  fetcher?: typeof fetch;
}): EffectHandler {
  return {
    async execute(effect, context) {
      const payload = effect.payload;
      if (typeof payload.title !== "string" || typeof payload.startsAt !== "string" || typeof payload.endsAt !== "string") {
        throw new Error("INVALID_CALENDAR_EFFECT_PAYLOAD");
      }
      const event = await createGoogleCalendarEvent({
        accessToken: input.accessToken,
        calendarId: input.calendarId,
        title: payload.title,
        startsAt: payload.startsAt,
        endsAt: payload.endsAt,
        timeoutMs: input.timeoutMs,
        fetcher: input.fetcher,
        idempotencyKey: context.idempotencyKey,
      });
      return `Google Calendar event created: ${event.externalId}`;
    },
  };
}
