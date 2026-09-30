import { createGoogleCalendarEvent } from "./connectors.js";
import type { EffectHandler } from "./effect-dispatcher.js";

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
