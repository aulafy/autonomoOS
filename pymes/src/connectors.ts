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
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
}

function requireCredential(value: string): void {
  if (!value.trim()) throw new Error("MISSING_PROVIDER_CREDENTIAL");
}

/** Exact phone lookup avoids downloading the entire Holded contact book. */
export async function findHoldedContactsByPhone(input: {
  apiKey: string;
  phone: string;
  fetcher?: Fetcher;
}): Promise<ExternalContact[]> {
  requireCredential(input.apiKey);
  const phone = input.phone.trim();
  if (!phone || !/^\+?[\d ()-]{6,24}$/.test(phone)) throw new Error("INVALID_PHONE_QUERY");
  const url = new URL("https://api.holded.com/api/invoicing/v1/contacts");
  url.searchParams.set("phone", phone);
  const response = await (input.fetcher ?? fetch)(url, {
    method: "GET", headers: { key: input.apiKey, Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`HOLDED_READ_FAILED:${response.status}`);
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error("HOLDED_INVALID_RESPONSE");
  return data.flatMap(value => {
    const item = record(value);
    const externalId = nonempty(item?.id);
    const name = nonempty(item?.name);
    if (!externalId || !name) return [];
    return [{ provider: "holded" as const, externalId, name,
      email: nonempty(item?.email) ?? undefined,
      phone: nonempty(item?.phone) ?? nonempty(item?.mobile) ?? undefined }];
  });
}

/** One bounded page of timed events. All-day events require separate handling. */
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
  const response = await (input.fetcher ?? fetch)(url, {
    method: "GET", headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`GOOGLE_CALENDAR_READ_FAILED:${response.status}`);
  const data = record(await response.json());
  if (!data || !Array.isArray(data.items)) throw new Error("GOOGLE_CALENDAR_INVALID_RESPONSE");
  if (nonempty(data.nextPageToken)) throw new Error("GOOGLE_CALENDAR_PAGE_INCOMPLETE");
  return data.items.flatMap(value => {
    const item = record(value);
    if (!item || item.status === "cancelled") return [];
    const externalId = nonempty(item.id);
    const startsAt = validInstant(record(item.start)?.dateTime);
    const endsAt = validInstant(record(item.end)?.dateTime);
    if (!externalId || !startsAt || !endsAt) return [];
    return [{ provider: "google_calendar" as const, externalId,
      title: nonempty(item.summary) ?? "Cita sin título", startsAt, endsAt }];
  });
}
