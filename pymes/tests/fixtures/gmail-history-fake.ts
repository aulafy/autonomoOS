import { fakeGmail, mailbox, credentialSource, NOW, DAY, type FakeMessage } from "./gmail-inbox-fake.js";

/** P04a synthetic Gmail with users.history.list on top of the P03 fake. Ids grow with gaps. */
export interface HistoryFakeOptions {
  onRequest?: (path: string, n: number) => void | Promise<void>;
  failOnce?: (path: string, n: number) => number | null;
  email?: string;
}
export function historyGmail(messages: FakeMessage[], opts: HistoryFakeOptions = {}) {
  let history = 1000, oldest = 0, n = 0;
  const events: { id: number; gmailId: string; kind: "added" | "deleted" | "labels" }[] = [];
  const counts = { history: 0, total: 0 };
  const base = fakeGmail(messages, { historyId: () => String(history), email: opts.email });
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
  const fetcher: typeof fetch = async (input, init) => {
    if ((init?.method ?? "GET").toUpperCase() !== "GET") return json({}, 405);
    const url = new URL(String(input));
    const path = url.pathname.replace("/gmail/v1/users/me/", "") + url.search;
    counts.total++;
    n++;
    init?.signal?.throwIfAborted();
    await opts.onRequest?.(path, n);
    init?.signal?.throwIfAborted();
    const forced = opts.failOnce?.(path, n);
    if (forced) return json({ error: { code: forced } }, forced);
    if (url.pathname.endsWith("/history")) {
      counts.history++;
      const start = Number(url.searchParams.get("startHistoryId"));
      if (!Number.isFinite(start) || start < oldest) return json({ error: { code: 404 } }, 404);
      const size = Number(url.searchParams.get("maxResults") ?? 100);
      const offset = Number(url.searchParams.get("pageToken") ?? 0);
      const all = events.filter((e) => e.id > start);
      const page = all.slice(offset, offset + size);
      return json({
        ...(page.length
          ? {
              history: page.map((e) => ({
                id: String(e.id),
                messages: [{ id: e.gmailId }],
                ...(e.kind === "added" ? { messagesAdded: [{ message: { id: e.gmailId, labelIds: [] } }] } : e.kind === "deleted" ? { messagesDeleted: [{ message: { id: e.gmailId } }] } : { labelsAdded: [{ message: { id: e.gmailId }, labelIds: [] }] }),
              })),
            }
          : {}),
        historyId: String(history),
        ...(offset + size < all.length ? { nextPageToken: String(offset + size) } : {}),
      });
    }
    return base.fetcher(input, init);
  };
  const push = (gmailId: string, kind: "added" | "deleted" | "labels") => {
    history += 3; // ids increase with gaps
    events.push({ id: history, gmailId, kind });
  };
  return {
    fetcher,
    counts,
    base,
    messages,
    get historyId() { return String(history); },
    add(m: FakeMessage) { messages.push(m); push(m.id, "added"); },
    remove(id: string) { const i = messages.findIndex((m) => m.id === id); if (i >= 0) messages.splice(i, 1); push(id, "deleted"); },
    setLabels(id: string, labels: string[]) { messages.find((m) => m.id === id)!.labels = labels; push(id, "labels"); },
    /** Mutations Gmail applied while our cursor was too old to see them. */
    silently(fn: () => void) { fn(); },
    /** Every cursor issued so far becomes invalid (history.list → 404). */
    expire() { history += 10; oldest = history; },
  };
}
export function msg(id: string, opts: Partial<FakeMessage> = {}): FakeMessage {
  return { id, internalDate: NOW - DAY, labels: ["INBOX"], subject: "Asunto " + id, body: "Cuerpo " + id, ...opts };
}
export { mailbox, credentialSource, NOW, DAY };
