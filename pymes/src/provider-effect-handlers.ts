import { createGoogleCalendarEvent } from "./connectors.js";
import type { EffectHandler } from "./effect-dispatcher.js";

export function messageEffectHandler(input: {
  send: (message: { channel: "whatsapp" | "telegram" | "imessage" | "email"; text: string; contactId?: string }) => Promise<{ externalId: string }>;
}): EffectHandler {
  return {
    async execute(effect) {
      const payload = effect.payload;
      if ((payload.channel !== "whatsapp" && payload.channel !== "telegram" && payload.channel !== "imessage" && payload.channel !== "email") || typeof payload.text !== "string" || !payload.text.trim() || payload.text.length > 4_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(payload.text)) {
        throw new Error("INVALID_MESSAGE_EFFECT_PAYLOAD");
      }
      const result = await input.send({ channel: payload.channel, text: payload.text, contactId: typeof payload.contactId === "string" ? payload.contactId : undefined });
      if (!result || typeof result.externalId !== "string" || !result.externalId.trim() || result.externalId.length > 200) throw new Error("INVALID_MESSAGE_PROVIDER_RESPONSE");
      return `Message sent via ${payload.channel}: ${result.externalId}`;
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
    async execute(effect) {
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
      });
      return `Google Calendar event created: ${event.externalId}`;
    },
  };
}
