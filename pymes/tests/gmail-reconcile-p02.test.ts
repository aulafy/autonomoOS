import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  GmailOAuth,
  GMAIL_SEND_SCOPE,
  GMAIL_READ_SCOPE,
} from "../src/gmail-oauth.js";
import {
  GmailEmailProvider,
  DEFAULT_GMAIL_SCAN_BUDGET,
  type GmailScanBudget,
} from "../src/gmail-email-provider.js";
import {
  gmailMime,
  gmailMessageId,
  gmailEffectMarker,
  verifyGmailRaw,
} from "../src/gmail-mime.js";
import { emailHash, type EmailPayload } from "../src/email-provider.js";
import type { CredentialVault } from "../src/gmail-keychain.js";

class Vault implements CredentialVault {
  values = new Map<string, string>();
  async get(k: string) {
    return this.values.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.values.set(k, v);
  }
  async delete(k: string) {
    this.values.delete(k);
  }
}
const payload: EmailPayload = {
  from: "owner@example.test",
  to: ["client@example.test"],
  cc: [],
  bcc: [],
  subject: "M3-P02 · Renovación 🚗",
  body: "Texto aprobado.\r\nLínea 2",
  contactId: "test-contact",
};
const KEY_A = "a".repeat(64),
  KEY_B = "b".repeat(64);
const b64 = (s: string) => Buffer.from(s).toString("base64url");
/** What the real pilot observed: Gmail keeps content, replaces Message-ID. */
const rewriteMessageId = (mime: string) =>
  mime.replace(
    /^Message-ID: .*$/m,
    "Message-ID: <CAGoogle-rewritten@mail.gmail.com>",
  );

interface Stored {
  id: string;
  raw: string;
  labels: string[];
}
/** In-memory Gmail: POST send, rfc822msgid search, SENT listing with pages, raw get. */
function fakeGmail(
  opts: {
    transform?: (mime: string) => string;
    loseSendResponse?: boolean;
    pageSize?: number;
    listStatus?: number;
    rawStatus?: (id: string) => number;
    endlessPages?: boolean;
  } = {},
) {
  const store: Stored[] = [];
  const counters = { posts: 0, lists: 0, searches: 0, raws: 0 };
  let n = 0;
  const json = (v: unknown, status = 200) =>
    new Response(JSON.stringify(v), { status });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (init?.method === "POST") {
      counters.posts++;
      const mime = Buffer.from(
        JSON.parse(String(init.body)).raw,
        "base64url",
      ).toString("utf8");
      const id = "m" + ++n;
      store.push({
        id,
        raw: b64((opts.transform ?? ((x) => x))(mime)),
        labels: ["SENT"],
      });
      if (opts.loseSendResponse) throw new Error("synthetic response lost");
      return json({ id });
    }
    const raw = url.pathname.match(/\/messages\/([^/]+)$/);
    if (raw) {
      counters.raws++;
      const status = opts.rawStatus?.(raw[1]!) ?? 200;
      const m = store.find((s) => s.id === raw[1]);
      if (status !== 200 || !m) return json({}, status === 200 ? 404 : status);
      return json({ id: m.id, labelIds: m.labels, raw: m.raw });
    }
    const q = url.searchParams.get("q") ?? "";
    if (q.startsWith("in:sent rfc822msgid:")) {
      counters.searches++;
      const wanted = q.slice("in:sent rfc822msgid:".length);
      const hits = store.filter((s) =>
        Buffer.from(s.raw, "base64url")
          .toString("utf8")
          .includes("Message-ID: " + wanted),
      );
      return json(
        hits.length ? { messages: hits.map((h) => ({ id: h.id })) } : {},
      );
    }
    if (url.searchParams.get("labelIds") === "SENT") {
      counters.lists++;
      if (opts.listStatus) return json({}, opts.listStatus);
      assert.match(q, /^after:\d+$/);
      const size = opts.pageSize ?? Number(url.searchParams.get("maxResults"));
      const start = Number(url.searchParams.get("pageToken") ?? 0);
      const slice = store
        .filter((s) => s.labels.includes("SENT"))
        .slice(start, start + size);
      const more = opts.endlessPages || start + size < store.length;
      return json({
        ...(slice.length ? { messages: slice.map((s) => ({ id: s.id })) } : {}),
        ...(more ? { nextPageToken: String(start + size) } : {}),
      });
    }
    return json({}, 404);
  };
  /** Adds an unrelated or crafted message directly to SENT. */
  const add = (mime: string, labels = ["SENT"]) => {
    const id = "x" + ++n;
    store.push({ id, raw: b64(mime), labels });
    return id;
  };
  return { fetcher, counters, store, add };
}
const credential = {
  accessToken: "synthetic-access",
  refreshToken: "synthetic-refresh",
  expiresAt: Date.now() + 3600000,
  clientId: "test.apps.googleusercontent.com",
  clientSecret: "synthetic-client",
  account: payload.from,
  subject: "account-one",
  scopes: [GMAIL_SEND_SCOPE, GMAIL_READ_SCOPE, "openid", "email"],
  generation: "b".repeat(64),
};
async function provider(
  fetcher: typeof fetch,
  path = ":memory:",
  budget: GmailScanBudget = DEFAULT_GMAIL_SCAN_BUDGET,
) {
  const vault = new Vault(),
    oauth = new GmailOAuth(
      vault,
      { tenant: "agency", owner: "owner" },
      async () => {},
      fetcher,
    );
  await vault.set(oauth.credentialRef, JSON.stringify(credential));
  const p = new GmailEmailProvider(oauth, path, fetcher, 1000, budget);
  await p.status();
  return {
    p,
    close: () => {
      p.close();
      oauth.close();
    },
  };
}
const signal = () => new AbortController().signal;
const filler = (i: number) =>
  gmailMime(
    { ...payload, subject: "Otro correo " + i, body: "otro " + i },
    i.toString(16).padStart(64, "c"),
  );

test("MIME v2 carries one effect marker distinct from the payload hash; Message-ID unchanged", () => {
  const mime = gmailMime(payload, KEY_A);
  assert.equal(mime.match(/^X-AWOS-Effect-Key: /gm)?.length, 1);
  assert.ok(mime.includes("X-AWOS-Effect-Key: " + gmailEffectMarker(KEY_A)));
  assert.ok(mime.includes("Message-ID: " + gmailMessageId(KEY_A)));
  assert.notEqual(gmailEffectMarker(KEY_A), emailHash(payload));
  assert.notEqual(gmailEffectMarker(KEY_A), gmailEffectMarker(KEY_B));
  assert.match(gmailEffectMarker(KEY_A), /^awos2\.[a-f0-9]{64}$/);
});

test("v2 verification: rewritten Message-ID passes; v1 (legacy) still requires it", () => {
  const raw = b64(rewriteMessageId(gmailMime(payload, KEY_A)));
  assert.equal(verifyGmailRaw(raw, payload, KEY_A, 2), true);
  assert.equal(verifyGmailRaw(raw, payload, KEY_A, 1), false);
});

test("v2 verification rejects altered content, foreign/missing/duplicate/malformed marker", () => {
  const mime = rewriteMessageId(gmailMime(payload, KEY_A));
  for (const [name, m] of [
    [
      "body",
      mime.replace(
        Buffer.from(payload.body).toString("base64").slice(0, 8),
        "QUFBQUFB",
      ),
    ],
    [
      "subject",
      rewriteMessageId(
        gmailMime({ ...payload, subject: payload.subject + "!" }, KEY_A),
      ),
    ],
    ["cc", "Cc: other@example.test\r\n" + mime],
    ["foreign marker", rewriteMessageId(gmailMime(payload, KEY_B))],
    ["missing marker", mime.replace(/^X-AWOS-Effect-Key: .*\r\n/m, "")],
    [
      "duplicate marker",
      "X-AWOS-Effect-Key: " + gmailEffectMarker(KEY_A) + "\r\n" + mime,
    ],
    [
      "malformed marker",
      mime.replace(/^X-AWOS-Effect-Key: .*$/m, "X-AWOS-Effect-Key: awos2.zz"),
    ],
  ] as const)
    assert.equal(verifyGmailRaw(b64(m), payload, KEY_A, 2), false, name);
});

test("lost response + Gmail rewrites Message-ID + restart: SENT scan reconciles, no second POST", async () => {
  const dir = mkdtempSync(join(tmpdir(), "p02-lost-"));
  const g = fakeGmail({ transform: rewriteMessageId, loseSendResponse: true });
  for (let i = 0; i < 7; i++) g.add(filler(i));
  let f = await provider(g.fetcher, join(dir, "claims.db"));
  try {
    await assert.rejects(f.p.send(payload, KEY_A, signal()));
    f.close();
    f = await provider(g.fetcher, join(dir, "claims.db"), {
      ...DEFAULT_GMAIL_SCAN_BUDGET,
      pageSize: 3,
    });
    const r = await f.p.reconcile(KEY_A, signal());
    assert.equal(r?.id, "gmail:m8");
    assert.equal(g.counters.searches, 1); // Message-ID search missed, as in the pilot
    assert.ok(g.counters.lists >= 3); // paged to the end
    await assert.rejects(f.p.send(payload, KEY_A, signal()));
    assert.equal(g.counters.posts, 1);
  } finally {
    f.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("known gmail_id with rewritten Message-ID observes directly (path of test A)", async () => {
  const g = fakeGmail({ transform: rewriteMessageId });
  const f = await provider(g.fetcher);
  try {
    await f.p.send(payload, KEY_A, signal());
    assert.equal((await f.p.observe(KEY_A, signal()))?.id, "gmail:m1");
    assert.equal(g.counters.lists, 0);
  } finally {
    f.close();
  }
});

test("same payload under another effect's marker never reconciles this effect", async () => {
  const g = fakeGmail({ transform: rewriteMessageId, loseSendResponse: true });
  const f = await provider(g.fetcher);
  try {
    await assert.rejects(f.p.send(payload, KEY_A, signal()));
    g.store.length = 0; // our message absent; only another effect's identical payload
    g.add(rewriteMessageId(gmailMime(payload, KEY_B)));
    assert.equal(await f.p.reconcile(KEY_A, signal()), null);
    assert.equal(g.counters.posts, 1);
  } finally {
    f.close();
  }
});

test("two SENT messages carrying this effect's marker and payload stay UNKNOWN", async () => {
  const g = fakeGmail({ transform: rewriteMessageId, loseSendResponse: true });
  const f = await provider(g.fetcher);
  try {
    await assert.rejects(f.p.send(payload, KEY_A, signal()));
    g.add(rewriteMessageId(gmailMime(payload, KEY_A)));
    assert.equal(await f.p.reconcile(KEY_A, signal()), null);
  } finally {
    f.close();
  }
});

test("matching message not labelled SENT is not evidence", async () => {
  const g = fakeGmail({ transform: rewriteMessageId, loseSendResponse: true });
  const f = await provider(g.fetcher);
  try {
    await assert.rejects(f.p.send(payload, KEY_A, signal()));
    g.store[0]!.labels = ["INBOX"];
    g.add(rewriteMessageId(gmailMime(payload, KEY_A)), ["INBOX"]);
    assert.equal(await f.p.reconcile(KEY_A, signal()), null);
  } finally {
    f.close();
  }
});

for (const [name, opts, budget] of [
  ["page budget exhausted", { endlessPages: true }, { maxPages: 2 }],
  ["raw-read budget exhausted", {}, { maxRawReads: 3 }],
  ["listing HTTP error", { listStatus: 500 }, {}],
  ["listing 429", { listStatus: 429 }, {}],
] as const)
  test(`${name}: UNKNOWN kept even if the match exists, no POST`, async () => {
    const g = fakeGmail({
      transform: rewriteMessageId,
      loseSendResponse: true,
      ...opts,
    });
    const f = await provider(g.fetcher, ":memory:", {
      ...DEFAULT_GMAIL_SCAN_BUDGET,
      pageSize: 2,
      ...budget,
    });
    try {
      await assert.rejects(f.p.send(payload, KEY_A, signal()));
      // The real match is first in the listing; later pages exceed the budget.
      for (let i = 0; i < 5; i++) g.add(filler(i));
      assert.equal(await f.p.reconcile(KEY_A, signal()), null);
      if (!("listStatus" in opts)) assert.ok(g.counters.raws >= 1);
      assert.equal(g.counters.posts, 1);
    } finally {
      f.close();
    }
  });

test("control: same layout with generous budget reconciles (budget tests fail only by budget)", async () => {
  const g = fakeGmail({ transform: rewriteMessageId, loseSendResponse: true });
  const f = await provider(g.fetcher, ":memory:", {
    ...DEFAULT_GMAIL_SCAN_BUDGET,
    pageSize: 2,
  });
  try {
    await assert.rejects(f.p.send(payload, KEY_A, signal()));
    for (let i = 0; i < 5; i++) g.add(filler(i));
    assert.equal((await f.p.reconcile(KEY_A, signal()))?.id, "gmail:m1");
  } finally {
    f.close();
  }
});

test("an unverifiable candidate (raw get fails) blocks proof of uniqueness", async () => {
  const g = fakeGmail({
    transform: rewriteMessageId,
    loseSendResponse: true,
    rawStatus: (id) => (id === "x1" ? 500 : 200),
  });
  g.add(filler(1)); // x1 fails to load: could have been a duplicate
  const f = await provider(g.fetcher);
  try {
    await assert.rejects(f.p.send(payload, KEY_A, signal()));
    assert.equal(await f.p.reconcile(KEY_A, signal()), null);
  } finally {
    f.close();
  }
});

test("legacy claim (pre-P02 schema) keeps v1 rules: no scan, no upgrade, no rewrite, stays UNKNOWN", async () => {
  const dir = mkdtempSync(join(tmpdir(), "p02-legacy-")),
    path = join(dir, "claims.db");
  const old = new DatabaseSync(path);
  old.exec(
    "CREATE TABLE claims(key TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,payload TEXT NOT NULL,subject TEXT NOT NULL,message_id TEXT NOT NULL,gmail_id TEXT)",
  );
  old
    .prepare("INSERT INTO claims VALUES(?,?,?,?,?,?)")
    .run(
      KEY_A,
      emailHash(payload),
      JSON.stringify(payload),
      "account-one",
      gmailMessageId(KEY_A),
      "legacy1",
    );
  old.close();
  // Legacy message as sent before P02 (no marker), Message-ID rewritten by Gmail.
  const legacyMime = rewriteMessageId(gmailMime(payload, KEY_A)).replace(
    /^X-AWOS-Effect-Key: .*\r\n/m,
    "",
  );
  const g = fakeGmail();
  g.store.push({ id: "legacy1", raw: b64(legacyMime), labels: ["SENT"] });
  const f = await provider(g.fetcher, path);
  try {
    assert.equal(await f.p.reconcile(KEY_A, signal()), null);
    assert.equal(g.counters.lists, 0);
    await assert.rejects(f.p.send(payload, KEY_A, signal()));
    assert.equal(g.counters.posts, 0);
    f.close();
    const check = new DatabaseSync(path);
    const row = check
      .prepare(
        "SELECT gmail_id,identity_version,claimed_at FROM claims WHERE key=?",
      )
      .get(KEY_A) as Record<string, unknown>;
    check.close();
    assert.deepEqual(
      { ...row },
      { gmail_id: "legacy1", identity_version: null, claimed_at: null },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("new claims are written as identity version 2 with a claim time", async () => {
  const dir = mkdtempSync(join(tmpdir(), "p02-v2-")),
    path = join(dir, "claims.db");
  const g = fakeGmail();
  const f = await provider(g.fetcher, path);
  await f.p.send(payload, KEY_A, signal());
  f.close();
  const db = new DatabaseSync(path);
  const row = db
    .prepare("SELECT identity_version,claimed_at FROM claims WHERE key=?")
    .get(KEY_A) as Record<string, number>;
  db.close();
  rmSync(dir, { recursive: true, force: true });
  assert.equal(row.identity_version, 2);
  assert.ok(Math.abs(row.claimed_at! - Date.now()) < 60000);
});

test("P01 selection still parses the v2 MIME (extra header, deterministic Message-ID at send time)", async () => {
  const { inspectSendBody } = await import("../src/gmail-fault-injection.js");
  const body = JSON.stringify({ raw: b64(gmailMime(payload, KEY_A)) });
  const seen = inspectSendBody(body);
  assert.ok(seen);
  assert.equal(seen.subject, payload.subject);
  assert.equal(seen.to, payload.to[0]);
  assert.equal(seen.messageId, gmailMessageId(KEY_A));
});

test("invalid or unbounded scan budgets are rejected before opening the ledger", () => {
  for (const override of [
    { maxPages: Infinity },
    { maxPages: 6 },
    { pageSize: 0 },
    { pageSize: 101 },
    { maxRawReads: NaN },
    { maxRawReads: 201 },
    { windowBeforeClaimMs: -1 },
  ]) {
    assert.throws(
      () =>
        new GmailEmailProvider({} as GmailOAuth, ":memory:", fetch, 1000, {
          ...DEFAULT_GMAIL_SCAN_BUDGET,
          ...override,
        }),
      /INVALID_GMAIL_SCAN_BUDGET/,
    );
  }
});

test("malformed raw candidate blocks uniqueness even after a matching message", async () => {
  const g = fakeGmail({ transform: rewriteMessageId, loseSendResponse: true });
  const f = await provider(g.fetcher);
  try {
    await assert.rejects(f.p.send(payload, KEY_A, signal()));
    const id = g.add(filler(1));
    g.store.find((m) => m.id === id)!.raw = "not valid base64!";
    assert.equal(await f.p.reconcile(KEY_A, signal()), null);
    assert.equal(g.counters.posts, 1);
  } finally {
    f.close();
  }
});

test("external budget mutation cannot remove the scan bounds", async () => {
  const g = fakeGmail({ transform: rewriteMessageId, loseSendResponse: true });
  const budget = { ...DEFAULT_GMAIL_SCAN_BUDGET, maxRawReads: 1 };
  const f = await provider(g.fetcher, ":memory:", budget);
  try {
    await assert.rejects(f.p.send(payload, KEY_A, signal()));
    g.add(filler(1));
    budget.maxRawReads = 200;
    assert.equal(await f.p.reconcile(KEY_A, signal()), null);
    assert.equal(g.counters.posts, 1);
  } finally {
    f.close();
  }
});

test("repeated pagination token cannot complete a proof after seeing a match", async () => {
  const g = fakeGmail({ transform: rewriteMessageId, loseSendResponse: true });
  let pages = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const u = new URL(String(input));
    if (u.searchParams.get("labelIds") === "SENT") {
      pages++;
      return new Response(
        JSON.stringify({
          messages: pages === 1 ? [{ id: "m1" }] : [],
          nextPageToken: "same",
        }),
      );
    }
    return g.fetcher(input, init);
  };
  const f = await provider(fetcher);
  try {
    await assert.rejects(f.p.send(payload, KEY_A, signal()));
    assert.equal(await f.p.reconcile(KEY_A, signal()), null);
    assert.equal(pages, 2);
    assert.equal(g.counters.posts, 1);
  } finally {
    f.close();
  }
});
