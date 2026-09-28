/** Provider reads only. Credentials are supplied by a server-side caller. */
export interface ExternalContact {
  provider: "holded";
  externalId: string;
  name: string;
  email?: string;
  phone?: string;
}

export interface ExternalCalendarEvent {
  provider: "google_calendar";
  externalId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
}

type Fetcher = typeof fetch;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function nonempty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validInstant(value: unknown): string | null {
  const text = nonempty(value);
  return text && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) &&
    !Number.isNaN(Date.parse(text)) ? text : null;
}

function validDate(value: unknown): string | null {
  const text = nonempty(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text
    ? text : null;
}

function requireCredential(value: string): void {
  if (!value.trim()) throw new Error("MISSING_PROVIDER_CREDENTIAL");
}

/** Exact phone and mobile lookups avoid downloading the entire contact book. */
export async function findHoldedContactsByPhone(input: {
  apiKey: string;
  phone: string;
  fetcher?: Fetcher;
}): Promise<ExternalContact[]> {
  requireCredential(input.apiKey);
  const phone = input.phone.trim();
  if (!phone || !/^\+?[\d ()-]{6,24}$/.test(phone)) throw new Error("INVALID_PHONE_QUERY");
  const records: unknown[] = [];
  for (const field of ["phone", "mobile"] as const) {
    const url = new URL("https://api.holded.com/api/invoicing/v1/contacts");
    url.searchParams.set(field, phone);
    const response = await (input.fetcher ?? fetch)(url, {
      method: "GET", headers: { key: input.apiKey, Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`HOLDED_READ_FAILED:${response.status}`);
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error("HOLDED_INVALID_RESPONSE");
    records.push(...data);
  }
  const seen = new Set<string>();
  return records.flatMap(value => {
    const item = record(value);
    const externalId = nonempty(item?.id);
    const name = nonempty(item?.name);
    if (!externalId || !name || seen.has(externalId)) return [];
    seen.add(externalId);
    return [{ provider: "holded" as const, externalId, name,
      email: nonempty(item?.email) ?? undefined,
      phone: nonempty(item?.phone) ?? nonempty(item?.mobile) ?? undefined }];
  });
}

/** Bounded complete read of timed and all-day events. */
export async function listGoogleCalendarEvents(input: {
  accessToken: string;
  calendarId: string;
  timeMin: string;
  timeMax: string;
  fetcher?: Fetcher;
}): Promise<ExternalCalendarEvent[]> {
  requireCredential(input.accessToken);
  if (!input.calendarId.trim()) throw new Error("MISSING_CALENDAR_ID");
  const min = validInstant(input.timeMin);
  const max = validInstant(input.timeMax);
  if (!min || !max || Date.parse(min) >= Date.parse(max)) throw new Error("INVALID_CALENDAR_WINDOW");
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`);
  url.searchParams.set("timeMin", min);
  url.searchParams.set("timeMax", max);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "100");
  const result: ExternalCalendarEvent[] = [];
  const seenPages = new Set<string>();
  const seenEvents = new Set<string>();
  for (let page = 0; page < 10; page++) {
    const response = await (input.fetcher ?? fetch)(url, {
      method: "GET", headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`GOOGLE_CALENDAR_READ_FAILED:${response.status}`);
    const data = record(await response.json());
    if (!data || !Array.isArray(data.items)) throw new Error("GOOGLE_CALENDAR_INVALID_RESPONSE");
    for (const value of data.items) {
      const item = record(value);
      if (!item) throw new Error("GOOGLE_CALENDAR_INVALID_EVENT");
      if (item.status === "cancelled") continue;
      const externalId = nonempty(item.id);
      const start = record(item.start);
      const end = record(item.end);
      const timedStart = validInstant(start?.dateTime);
      const timedEnd = validInstant(end?.dateTime);
      const allDayStart = validDate(start?.date);
      const allDayEnd = validDate(end?.date);
      const allDay = !!allDayStart && !!allDayEnd;
      const startsAt = timedStart && timedEnd ? timedStart : allDayStart;
      const endsAt = timedStart && timedEnd ? timedEnd : allDayEnd;
      if (!externalId || !startsAt || !endsAt) throw new Error("GOOGLE_CALENDAR_INVALID_EVENT");
      if (allDay ? endsAt <= startsAt : Date.parse(endsAt) <= Date.parse(startsAt)) {
        throw new Error("GOOGLE_CALENDAR_INVALID_EVENT_TIME");
      }
      if (seenEvents.has(externalId)) throw new Error("GOOGLE_CALENDAR_DUPLICATE_EVENT");
      seenEvents.add(externalId);
      result.push({ provider: "google_calendar", externalId,
        title: nonempty(item.summary) ?? "Cita sin título", startsAt, endsAt, allDay });
    }
    const nextPage = nonempty(data.nextPageToken);
    if (!nextPage) return result;
    if (seenPages.has(nextPage)) throw new Error("GOOGLE_CALENDAR_REPEATED_PAGE");
    seenPages.add(nextPage);
    url.searchParams.set("pageToken", nextPage);
  }
  throw new Error("GOOGLE_CALENDAR_PAGE_LIMIT");
}
