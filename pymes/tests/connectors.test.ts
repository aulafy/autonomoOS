import assert from "node:assert/strict";
import test from "node:test";
import { findHoldedContactsByPhone, listGoogleCalendarEvents } from "../src/connectors.js";

test("Holded reads an exact phone match without fetching the whole address book", async () => {
  const requests: Array<{ url: URL; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    requests.push({ url: new URL(String(url)), init });
    return Response.json([{ id: "c-1", name: "Ana Ruiz", phone: "+34600111222" },
      { id: "", name: "Incomplete" }]);
  };
  const contacts = await findHoldedContactsByPhone({
    apiKey: "demo-key", phone: "+34600111222", fetcher
  });
  assert.deepEqual(contacts, [{ provider: "holded", externalId: "c-1", name: "Ana Ruiz",
    email: undefined, phone: "+34600111222" }]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.url.pathname, "/api/invoicing/v1/contacts");
  assert.equal(requests[0]?.url.searchParams.get("phone"), "+34600111222");
  assert.equal(requests[1]?.url.searchParams.get("mobile"), "+34600111222");
  assert.equal(requests[0]?.init?.method, "GET");
  assert.ok(requests[0]?.init?.signal instanceof AbortSignal);
  assert.equal((requests[0]?.init?.headers as Record<string, string>).key, "demo-key");
  assert.equal(requests[0]?.url.search.includes("demo-key"), false);
});

test("Google Calendar reads all pages and keeps timed and all-day events", async () => {
  let calledUrl: URL | undefined;
  const pageTokens: Array<string | null> = [];
  const fetcher: typeof fetch = async url => {
    calledUrl = new URL(String(url));
    pageTokens.push(calledUrl.searchParams.get("pageToken"));
    if (calledUrl.searchParams.get("pageToken") === "next") {
      return Response.json({ items: [
        { id: "event-3", summary: "Seguimiento", start: { dateTime: "2026-09-29T12:00:00+02:00" },
          end: { dateTime: "2026-09-29T12:30:00+02:00" } }
      ] });
    }
    return Response.json({ nextPageToken: "next", items: [
      { id: "event-1", summary: "Llamada", start: { dateTime: "2026-09-29T09:00:00+02:00" },
        end: { dateTime: "2026-09-29T09:30:00+02:00" } },
      { id: "event-2", status: "cancelled" },
      { id: "all-day", start: { date: "2026-09-30" }, end: { date: "2026-10-01" } }
    ] });
  };
  const input = { accessToken: "demo-token", calendarId: "primary",
    timeMin: "2026-09-29T00:00:00+02:00", timeMax: "2026-10-01T00:00:00+02:00" };
  const events = await listGoogleCalendarEvents({ ...input, fetcher });
  assert.deepEqual(events, [{ provider: "google_calendar", externalId: "event-1",
    title: "Llamada", startsAt: "2026-09-29T09:00:00+02:00",
    endsAt: "2026-09-29T09:30:00+02:00", allDay: false },
  { provider: "google_calendar", externalId: "all-day", title: "Cita sin título",
    startsAt: "2026-09-30", endsAt: "2026-10-01", allDay: true },
  { provider: "google_calendar", externalId: "event-3", title: "Seguimiento",
    startsAt: "2026-09-29T12:00:00+02:00", endsAt: "2026-09-29T12:30:00+02:00", allDay: false }]);
  assert.equal(calledUrl?.pathname, "/calendar/v3/calendars/primary/events");
  assert.equal(calledUrl?.searchParams.get("singleEvents"), "true");
  assert.equal(calledUrl?.searchParams.get("maxResults"), "100");
  assert.deepEqual(pageTokens, [null, "next"]);
  await assert.rejects(() => listGoogleCalendarEvents({ ...input,
    fetcher: async () => Response.json({ items: [], nextPageToken: "repeat" })
  }), /REPEATED_PAGE/);
  let page = 0;
  await assert.rejects(() => listGoogleCalendarEvents({ ...input,
    fetcher: async () => Response.json({ items: [], nextPageToken: `page-${++page}` })
  }), /PAGE_LIMIT/);
  assert.equal(page, 10);
  await assert.rejects(() => listGoogleCalendarEvents({ ...input,
    fetcher: async () => Response.json({ items: [{ id: "bad-date",
      start: { date: "2026-02-30" }, end: { date: "2026-03-01" } }] })
  }), /INVALID_EVENT/);
});

test("provider retry recovers from transient Holded failures", async () => {
  let calls = 0;
  const contacts = await findHoldedContactsByPhone({
    apiKey: "demo-key", phone: "+34600111222", timeoutMs: 1_000,
    fetcher: async () => {
      calls += 1;
      return calls < 3 ? new Response(null, { status: 503 }) : Response.json([{ id: "c-1", name: "Ana Ruiz" }]);
    }
  });
  assert.equal(calls, 4);
  assert.equal(contacts[0]?.externalId, "c-1");
});

test("provider retry recovers from transient transport failures", async () => {
  let calls = 0;
  const contacts = await findHoldedContactsByPhone({
    apiKey: "demo-key", phone: "+34600111222", timeoutMs: 1_000,
    fetcher: async () => {
      calls += 1;
      if (calls === 1) throw new Error("ECONNRESET");
      return Response.json([{ id: "c-1", name: "Ana Ruiz" }]);
    }
  });
  assert.equal(calls, 3);
  assert.equal(contacts[0]?.externalId, "c-1");
});

test("provider retry stops after the bounded attempt count", async () => {
  let calls = 0;
  await assert.rejects(() => findHoldedContactsByPhone({
    apiKey: "demo-key", phone: "+34600111222", timeoutMs: 1_000,
    fetcher: async () => {
      calls += 1;
      return new Response(null, { status: 503 });
    }
  }), /HOLDED_READ_FAILED:503/);
  assert.equal(calls, 3);
});

test("missing credentials and provider failures never become empty successful reads", async () => {
  await assert.rejects(() => findHoldedContactsByPhone({ apiKey: "", phone: "+34600111222" }),
    /MISSING_PROVIDER_CREDENTIAL/);
  await assert.rejects(() => findHoldedContactsByPhone({ apiKey: "key", phone: "invalid", fetcher:
    async () => { throw new Error("should not call provider"); } }), /INVALID_PHONE_QUERY/);
  await assert.rejects(() => listGoogleCalendarEvents({ accessToken: "token", calendarId: "primary",
    timeMin: "2026-09-30T00:00:00Z", timeMax: "2026-09-29T00:00:00Z" }),
  /INVALID_CALENDAR_WINDOW/);
  await assert.rejects(() => findHoldedContactsByPhone({ apiKey: "key", phone: "+34600111222",
    fetcher: async () => new Response(null, { status: 403 }) }), /HOLDED_READ_FAILED:403/);
  await assert.rejects(() => findHoldedContactsByPhone({ apiKey: "key", phone: "+34600111222", timeoutMs: 50,
    fetcher: async () => new Response(null) }), /INVALID_PROVIDER_TIMEOUT/);
});
