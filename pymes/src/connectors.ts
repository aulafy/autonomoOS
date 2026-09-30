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

function timeoutValue(timeoutMs: number | undefined): number {
  const value = timeoutMs ?? 10_000;
  if (!Number.isInteger(value) || value < 100 || value > 60_000) throw new Error("INVALID_PROVIDER_TIMEOUT");
  return value;
}

async function providerFetch(fetcher: Fetcher, input: RequestInfo | URL, init: RequestInit, timeoutMs: number | undefined): Promise<Response> {
  const timeout = timeoutValue(timeoutMs);
  let lastResponse: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetcher(input, { ...init, signal: AbortSignal.timeout(timeout) });
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
      continue;
    }
    lastResponse = response;
    if (response.status !== 429 && (response.status < 500 || response.status >= 600)) return response;
    if (attempt < 2) {
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterSeconds = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
      const retryAfterDate = retryAfterHeader && Number.isNaN(retryAfterSeconds) ? Date.parse(retryAfterHeader) : Number.NaN;
      const delayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
        ? Math.min(retryAfterSeconds * 1_000, 2_000)
        : Number.isFinite(retryAfterDate)
          ? Math.min(Math.max(0, retryAfterDate - Date.now()), 2_000)
          : 25 * (attempt + 1);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return lastResponse!;
}

/** Exact phone and mobile lookups avoid downloading the entire contact book. */
export async function findHoldedContactsByPhone(input: {
  apiKey: string;
  phone: string;
  timeoutMs?: number;
  fetcher?: Fetcher;
}): Promise<ExternalContact[]> {
  requireCredential(input.apiKey);
  const phone = input.phone.trim();
  if (!phone || !/^\+?[\d ()-]{6,24}$/.test(phone)) throw new Error("INVALID_PHONE_QUERY");
  const records: unknown[] = [];
  for (const field of ["phone", "mobile"] as const) {
    const url = new URL("https://api.holded.com/api/invoicing/v1/contacts");
    url.searchParams.set(field, phone);
    const response = await providerFetch(input.fetcher ?? fetch, url, {
      method: "GET", headers: { key: input.apiKey, Accept: "application/json" }
    }, input.timeoutMs);
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
  timeoutMs?: number;
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
    const response = await providerFetch(input.fetcher ?? fetch, url, {
      method: "GET", headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json" }
    }, input.timeoutMs);
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

/** Creates a timed Google Calendar event after the workspace has confirmed it. */
export async function createGoogleCalendarEvent(input: {
  accessToken: string;
  calendarId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timeoutMs?: number;
  fetcher?: Fetcher;
  idempotencyKey?: string;
}): Promise<ExternalCalendarEvent> {
  requireCredential(input.accessToken);
  if (!input.calendarId.trim() || !nonempty(input.title)) throw new Error("INVALID_CALENDAR_EVENT_INPUT");
  const startsAt = validInstant(input.startsAt);
  const endsAt = validInstant(input.endsAt);
  if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) throw new Error("INVALID_CALENDAR_EVENT_TIME");
  const response = await providerFetch(input.fetcher ?? fetch,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ summary: input.title.trim(), start: { dateTime: startsAt }, end: { dateTime: endsAt }, ...(input.idempotencyKey ? { extendedProperties: { private: { pymesEffectId: input.idempotencyKey } } } : {}) }),
    }, input.timeoutMs);
  if (!response.ok) throw new Error(`GOOGLE_CALENDAR_WRITE_FAILED:${response.status}`);
  const item = record(await response.json());
  const externalId = nonempty(item?.id);
  const start = record(item?.start);
  const end = record(item?.end);
  const returnedStart = validInstant(start?.dateTime);
  const returnedEnd = validInstant(end?.dateTime);
  if (!externalId || !returnedStart || !returnedEnd || Date.parse(returnedEnd) <= Date.parse(returnedStart)) throw new Error("GOOGLE_CALENDAR_INVALID_CREATED_EVENT");
  return { provider: "google_calendar", externalId, title: nonempty(item?.summary) ?? input.title.trim(), startsAt: returnedStart, endsAt: returnedEnd, allDay: false };
}

export async function sendMessageWebhook(input: {
  endpoint: string;
  token: string;
  channel: "whatsapp" | "telegram" | "imessage" | "email";
  text: string;
  contactId?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  fetcher?: Fetcher;
}): Promise<{ externalId: string }> {
  requireCredential(input.token);
  if (!input.text.trim() || input.text.length > 4_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.text)) throw new Error("INVALID_MESSAGE_TEXT");
  let url: URL;
  try { url = new URL(input.endpoint); } catch { throw new Error("INVALID_MESSAGE_ENDPOINT"); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost"))) throw new Error("UNSAFE_MESSAGE_ENDPOINT");
  const response = await providerFetch(input.fetcher ?? fetch, url, {
    method: "POST", headers: { Authorization: `Bearer ${input.token}`, Accept: "application/json", "Content-Type": "application/json", ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}) },
    body: JSON.stringify({ channel: input.channel, text: input.text, ...(input.contactId ? { contactId: input.contactId } : {}) }),
  }, input.timeoutMs);
  if (!response.ok) throw new Error(`MESSAGE_PROVIDER_FAILED:${response.status}`);
  const data = record(await response.json());
  const externalId = nonempty(data?.externalId) ?? nonempty(data?.id);
  if (!externalId || externalId.length > 200) throw new Error("INVALID_MESSAGE_PROVIDER_RESPONSE");
  return { externalId };
}

export async function createCrmTaskWebhook(input: {
  endpoint: string;
  token: string;
  title: string;
  contactId: string;
  dueAt?: string;
  notes?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  fetcher?: Fetcher;
}): Promise<{ externalId: string }> {
  requireCredential(input.token);
  if (!input.title.trim() || input.title.length > 500 || !input.contactId.trim() || input.contactId.length > 200 || (input.dueAt !== undefined && Number.isNaN(Date.parse(input.dueAt)))) throw new Error("INVALID_CRM_TASK_INPUT");
  let url: URL;
  try { url = new URL(input.endpoint); } catch { throw new Error("INVALID_CRM_ENDPOINT"); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost"))) throw new Error("UNSAFE_CRM_ENDPOINT");
  const response = await providerFetch(input.fetcher ?? fetch, url, {
    method: "POST", headers: { Authorization: `Bearer ${input.token}`, Accept: "application/json", "Content-Type": "application/json", ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}) },
    body: JSON.stringify({ title: input.title.trim(), contactId: input.contactId.trim(), ...(input.dueAt ? { dueAt: input.dueAt } : {}), ...(input.notes ? { notes: input.notes.slice(0, 4_000) } : {}) }),
  }, input.timeoutMs);
  if (!response.ok) throw new Error(`CRM_PROVIDER_FAILED:${response.status}`);
  const data = record(await response.json());
  const externalId = nonempty(data?.externalId) ?? nonempty(data?.id);
  if (!externalId || externalId.length > 200) throw new Error("INVALID_CRM_PROVIDER_RESPONSE");
  return { externalId };
}

export async function startCallWebhook(input: {
  endpoint: string;
  token: string;
  phone?: string;
  objective?: string;
  questions?: string[];
  contactId?: string;
  idempotencyKey?: string;
  timeoutMs?: number;
  fetcher?: Fetcher;
}): Promise<{ externalId: string }> {
  requireCredential(input.token);
  if (!input.phone?.trim() && !input.objective?.trim()) throw new Error("INVALID_CALL_INPUT");
  if (input.phone !== undefined && (!/^\+?[\d ()-]{6,24}$/.test(input.phone) || input.phone.length > 100)) throw new Error("INVALID_CALL_PHONE");
  if (input.objective !== undefined && (!input.objective.trim() || input.objective.length > 2_000)) throw new Error("INVALID_CALL_OBJECTIVE");
  if (input.questions !== undefined && (input.questions.length > 100 || input.questions.some(value => !value.trim() || value.length > 500))) throw new Error("INVALID_CALL_QUESTIONS");
  let url: URL;
  try { url = new URL(input.endpoint); } catch { throw new Error("INVALID_CALL_ENDPOINT"); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost"))) throw new Error("UNSAFE_CALL_ENDPOINT");
  const response = await providerFetch(input.fetcher ?? fetch, url, {
    method: "POST", headers: { Authorization: `Bearer ${input.token}`, Accept: "application/json", "Content-Type": "application/json", ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}) },
    body: JSON.stringify({ ...(input.phone ? { phone: input.phone.trim() } : {}), ...(input.objective ? { objective: input.objective.trim() } : {}), ...(input.questions ? { questions: input.questions } : {}), ...(input.contactId ? { contactId: input.contactId } : {}) }),
  }, input.timeoutMs);
  if (!response.ok) throw new Error(`CALL_PROVIDER_FAILED:${response.status}`);
  const data = record(await response.json());
  const externalId = nonempty(data?.externalId) ?? nonempty(data?.id);
  if (!externalId || externalId.length > 200) throw new Error("INVALID_CALL_PROVIDER_RESPONSE");
  return { externalId };
}
