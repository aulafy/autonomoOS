import { GMAIL_SEND_SCOPE, GMAIL_READ_SCOPE, type GmailCredential } from "../../src/gmail-oauth.js";

/** Synthetic mailbox. All addresses are @example.test; no real mail. */
export interface FakeMessage {
  id: string;
  internalDate: number;
  labels: string[];
  subject: string;
  body: string;
  html?: boolean;
  bigBytes?: number;
}
export const DAY = 86_400_000;
export const NOW = Date.UTC(2026, 9, 4, 12, 0, 0);
export function mailbox(n: number, opts: { start?: number; labels?: (i: number) => string[] } = {}): FakeMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    id: "m" + String(i).padStart(4, "0"),
    internalDate: (opts.start ?? NOW - 10 * DAY) + i * 60_000,
    labels: opts.labels?.(i) ?? [i % 3 === 0 ? "SENT" : "INBOX"],
    subject: "Asunto " + i,
    body: "Cuerpo del mensaje " + i,
  }));
}
/** Deterministic shuffle: list order must not matter. */
function shuffled<T>(items: T[]): T[] {
  return items
    .map((v, i) => ({ v, k: (i * 7919 + 104729) % 1000003 }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.v);
}
export function payloadFor(m: FakeMessage) {
  const data = Buffer.from(m.html ? "<p>" + m.body + "</p>" : m.body).toString("base64url");
  return {
    mimeType: "multipart/mixed",
    headers: [
      { name: "From", value: "cliente@example.test" },
      { name: "To", value: "owner@example.test" },
      { name: "Subject", value: m.subject },
      { name: "Message-ID", value: `<${m.id}@example.test>` },
    ],
    parts: [{ partId: "0", mimeType: m.html ? "text/html" : "text/plain", headers: [{ name: "Content-Type", value: "text/plain; charset=UTF-8" }], body: { data } }],
  };
}
export interface FakeGmailOptions {
  historyId?: () => string;
  failOnce?: (path: string, n: number) => number | null;
  onRequest?: (path: string, n: number) => void | Promise<void>;
  email?: string;
}
export function fakeGmail(messages: FakeMessage[], opts: FakeGmailOptions = {}) {
  const counts = { total: 0, profile: 0, list: 0, dates: 0, full: 0, metadata: 0 };
  const methods = new Set<string>();
  let n = 0;
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
  const fetcher: typeof fetch = async (input, init) => {
    methods.add((init?.method ?? "GET").toUpperCase());
    const url = new URL(String(input));
    const path = url.pathname.replace("/gmail/v1/users/me/", "") + url.search;
    n++;
    counts.total++;
    init?.signal?.throwIfAborted();
    await opts.onRequest?.(path, n);
    init?.signal?.throwIfAborted();
    const forced = opts.failOnce?.(path, n);
    if (forced) return json({ error: { code: forced } }, forced);
    if (url.pathname.endsWith("/profile")) {
      counts.profile++;
      return json({ emailAddress: opts.email ?? "owner@example.test", historyId: opts.historyId?.() ?? "1000" });
    }
    const one = url.pathname.match(/\/messages\/([^/]+)$/);
    if (one) {
      const m = messages.find((x) => x.id === one[1]);
      const format = url.searchParams.get("format");
      if (url.searchParams.get("fields") === "id,labelIds,internalDate") counts.dates++;
      else if (format === "minimal") counts.dates++;
      else if (format === "metadata") counts.metadata++;
      else counts.full++;
      if (!m) return json({ error: { code: 404 } }, 404);
      const base = { id: m.id, threadId: "t" + m.id, labelIds: m.labels, internalDate: String(m.internalDate), sizeEstimate: m.body.length, snippet: m.subject };
      if (url.searchParams.get("fields") === "id,labelIds,internalDate") return json({id: m.id, labelIds:m.labels, internalDate:String(m.internalDate)});
      if (format === "minimal") return json({id:m.id,labelIds:m.labels});
      if (format === "metadata") return json({ ...base, payload: { headers: payloadFor(m).headers } });
      if (m.bigBytes) return json({ ...base, payload: payloadFor(m), pad: "x".repeat(m.bigBytes) });
      return json({ ...base, payload: payloadFor(m) });
    }
    if (url.pathname.endsWith("/messages")) {
      counts.list++;
      if (url.searchParams.get("includeSpamTrash") !== "false") return json({}, 400);
      const label = url.searchParams.get("labelIds");
      const after = Number((url.searchParams.get("q") ?? "").replace("after:", "")) * 1000;
      const size = Number(url.searchParams.get("maxResults"));
      const start = Number(url.searchParams.get("pageToken") ?? 0);
      const hits = shuffled(
        messages.filter(
          (m) => m.labels.includes(label!) && m.internalDate > after && !m.labels.includes("SPAM") && !m.labels.includes("TRASH"),
        ),
      );
      const page = hits.slice(start, start + size);
      return json({
        ...(page.length ? { messages: page.map((m) => ({ id: m.id, threadId: "t" + m.id })) } : {}),
        ...(start + size < hits.length ? { nextPageToken: String(start + size) } : {}),
        resultSizeEstimate: hits.length,
      });
    }
    return json({}, 404);
  };
  return { fetcher, counts, methods };
}
export function credential(overrides: Partial<GmailCredential> = {}): GmailCredential {
  return {
    accessToken: "synthetic-access-token-p03",
    refreshToken: "synthetic-refresh-p03",
    expiresAt: NOW + 3_600_000,
    clientId: "test.apps.googleusercontent.com",
    clientSecret: "synthetic-client-secret-p03",
    account: "owner@example.test",
    subject: "account-one",
    scopes: [GMAIL_SEND_SCOPE, GMAIL_READ_SCOPE, "openid", "email"],
    generation: "b".repeat(64),
    ...overrides,
  };
}
/** Mutable credential source: tests flip it to simulate disconnect/account change. */
export function credentialSource(initial = credential()) {
  const state: { cred: GmailCredential | null } = { cred: initial };
  return {
    state,
    source: {
      credential: async () => {
        if (!state.cred) throw new Error("GMAIL_NOT_CONNECTED");
        return state.cred;
      },
    },
  };
}
