import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fork } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { GmailInboxSync, type GmailInboxSyncOptions } from "../src/gmail-inbox-sync.js";
import { InboxStore, inboxNamespace, InboxStoreError } from "../src/inbox-store.js";
import { GMAIL_SEND_SCOPE } from "../src/gmail-oauth.js";
import { fakeGmail, mailbox, credential, credentialSource, NOW, DAY, type FakeMessage } from "./fixtures/gmail-inbox-fake.js";

const scope = { tenant: "agency", owner: "owner" };
const ns = inboxNamespace("agency", "owner", "account-one");
const small: Partial<GmailInboxSyncOptions> = { listPageSize: 4, maxCandidates: 100, selectionCap: 50, batchSize: 3 };
function setup(messages: FakeMessage[], gmailOpts = {}, options: Partial<GmailInboxSyncOptions> = small) {
  const dir = mkdtempSync(join(tmpdir(), "p03-")),
    path = join(dir, "inbox.db");
  const g = fakeGmail(messages, gmailOpts),
    c = credentialSource();
  const store = new InboxStore(path, () => NOW);
  const sync = new GmailInboxSync(c.source, store, scope, g.fetcher, options, () => NOW);
  return {
    dir, path, g, c, store, sync, options,
    reopen: () => new GmailInboxSync(c.source, new InboxStore(path, () => NOW), scope, g.fetcher, options, () => NOW),
    done: () => { try { store.close(); } catch {} rmSync(dir, { recursive: true, force: true }); },
  };
}

test("union INBOX|SENT, paginated, window and SPAM/TRASH excluded, both-label message once; H0 before listing", async () => {
  const msgs = mailbox(10);
  msgs[1]!.labels = ["INBOX", "SENT"];
  msgs[2]!.labels = ["INBOX", "SPAM"];
  msgs[3]!.labels = ["TRASH"];
  msgs[4]!.labels = ["CATEGORY_PROMOTIONS"]; // neither INBOX nor SENT
  msgs.push({ id: "old1", internalDate: NOW - 120 * DAY, labels: ["INBOX"], subject: "viejo", body: "viejo" });
  let h = 1000;
  const f = setup(msgs, { historyId: () => String(h++) }, { ...small, listPageSize: 2 });
  try {
    const r = await f.sync.fullSync();
    assert.equal(r.outcome, "complete");
    assert.equal(r.truncated, false);
    const ids = f.store.messageIds(ns);
    assert.deepEqual(ids, ["m0000", "m0001", "m0005", "m0006", "m0007", "m0008", "m0009"]);
    const n = f.store.namespace(ns)!;
    assert.equal(n.historyId, "1000"); // captured once, before enumeration
    assert.equal(n.syncState, "complete_window");
    assert.equal(n.catchupPending, true);
    assert.ok(f.g.counts.list >= 3); // paginated
    assert.deepEqual([...f.g.methods], ["GET"]);
    assert.equal(f.g.counts.dates, 0); // within cap: no date pass needed
    const m = f.store.message(ns, "m0005")!;
    assert.equal(m.subject, "Asunto 5");
    assert.equal(m.bodyText, "Cuerpo del mensaje 5");
  } finally {
    f.done();
  }
});

test("idempotent re-run: no duplicates, first-seen preserved", async () => {
  const f = setup(mailbox(8));
  try {
    await f.sync.fullSync();
    const first = f.store.message(ns, "m0003")!.firstSeenAt;
    assert.equal((await f.sync.fullSync()).outcome, "complete");
    assert.equal(f.store.messageIds(ns).length, 8);
    assert.equal(f.store.message(ns, "m0003")!.firstSeenAt, first);
  } finally {
    f.done();
  }
});

test("more than the selection cap: the newest by internalDate are selected regardless of list order; truncated, stable", async () => {
  const msgs = mailbox(12);
  // internalDate deliberately unrelated to id and to the (shuffled) list order
  msgs.forEach((m, i) => (m.internalDate = NOW - DAY - ((i * 5) % 12) * 3_600_000));
  const newest = [...msgs].sort((a, b) => b.internalDate - a.internalDate || (a.id < b.id ? 1 : -1)).slice(0, 5).map((m) => m.id).sort();
  const f = setup(msgs, {}, { ...small, selectionCap: 5 });
  try {
    const r = await f.sync.fullSync();
    assert.equal(r.outcome, "complete");
    assert.equal(r.truncated, true);
    assert.deepEqual(f.store.messageIds(ns), newest);
    assert.equal(f.g.counts.dates, 12); // a date for every candidate
    const n = f.store.namespace(ns)!;
    assert.equal(n.syncState, "complete_truncated");
    assert.equal(n.historyId, "1000");
    await f.sync.fullSync();
    assert.deepEqual(f.store.messageIds(ns), newest);
  } finally {
    f.done();
  }
});

test("exactly at the cap is not truncated", async () => {
  const f = setup(mailbox(5), {}, { ...small, selectionCap: 5 });
  try {
    const r = await f.sync.fullSync();
    assert.equal(r.truncated, false);
    assert.equal(f.store.namespace(ns)!.syncState, "complete_window");
  } finally {
    f.done();
  }
});

test("per-run budget pauses durably; resume keeps the same run, H0 and window; cursor only at the end", async () => {
  let h = 5000;
  const budget = { ...small, maxCandidates: 12, selectionCap: 12, listPageSize: 4, maxRequestsPerRun: 12 }; // enumeration needs 2*(3+1)+1 = 9
  const f = setup(mailbox(12), { historyId: () => String(h++) }, budget);
  try {
    const r1 = await f.sync.fullSync();
    assert.equal(r1.outcome, "paused");
    assert.equal(r1.code, "INBOX_RUN_BUDGET_REACHED");
    assert.equal(f.store.namespace(ns)!.historyId, null);
    assert.equal(f.store.namespace(ns)!.syncState, "in_progress");
    let r = r1,
      rounds = 0;
    while (r.outcome === "paused" && rounds++ < 20) {
      r = await f.reopen().fullSync();
      assert.equal(r.runId, r1.runId);
    }
    assert.equal(r.outcome, "complete");
    assert.equal(f.store.messageIds(ns).length, 12);
    assert.equal(f.store.namespace(ns)!.historyId, "5000");
    assert.equal(f.g.counts.profile, 1);
  } finally {
    f.done();
  }
});

test("budget too small to finish enumeration is rejected at construction", () => {
  const g = fakeGmail([]);
  const store = new InboxStore(":memory:");
  try {
    assert.throws(
      () => new GmailInboxSync(credentialSource().source, store, scope, g.fetcher, { listPageSize: 4, maxCandidates: 100, maxRequestsPerRun: 10 }),
      /INVALID_INBOX_SYNC_OPTIONS/,
    );
  } finally {
    store.close();
  }
});

test("HTTP 500 mid-fetch: paused, no cursor; next run resumes without duplicates or losses", async () => {
  let fired = false;
  const f = setup(mailbox(9), {
    failOnce: (path: string) => (!fired && path.includes("m0004?format=full") ? ((fired = true), 500) : null),
  });
  try {
    const r1 = await f.sync.fullSync();
    assert.equal(r1.outcome, "paused");
    assert.equal(r1.code, "GMAIL_UNAVAILABLE");
    assert.equal(f.store.namespace(ns)!.historyId, null);
    const partial = f.store.messageIds(ns).length;
    assert.ok(partial < 9);
    assert.equal((await f.sync.fullSync()).outcome, "complete");
    assert.deepEqual(f.store.messageIds(ns), mailbox(9).map((m) => m.id));
  } finally {
    f.done();
  }
});

test("abort mid-run then reopen the store: resumes the same run", async () => {
  const controller = new AbortController();
  const f = setup(mailbox(9), { onRequest: (path: string) => { if (path.includes("m0005?format=full")) controller.abort(); } });
  try {
    const r1 = await f.sync.fullSync(controller.signal);
    assert.equal(r1.outcome, "paused");
    assert.equal(r1.code, "INBOX_SYNC_ABORTED");
    f.store.close();
    const r2 = await f.reopen().fullSync();
    assert.equal(r2.outcome, "complete");
    assert.equal(r2.runId, r1.runId);
    const check = new InboxStore(f.path);
    assert.equal(check.messageIds(ns).length, 9);
    check.close();
  } finally {
    f.done();
  }
});

test("SIGKILL during fetch, restart on the same file: completes with no loss and no duplicates", { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "p03-kill-")),
    path = join(dir, "inbox.db");
  const child = fork(new URL("./fixtures/gmail-inbox-crash.ts", import.meta.url), [path], {
    execArgv: process.execArgv,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let errors = "";
  child.stderr?.on("data", (c) => (errors += c));
  try {
    await Promise.race([
      once(child, "message"),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("WAIT " + errors)), 20000).unref();
        child.once("exit", (c) => reject(new Error("EARLY_EXIT " + c + " " + errors)));
      }),
    ]);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    const g = fakeGmail(mailbox(20));
    const store = new InboxStore(path, () => NOW + 1); // lease of the killed process
    const before = store.messageIds(ns).length;
    assert.ok(before > 0 && before < 20);
    assert.equal(store.namespace(ns)!.historyId, null);
    // The dead holder's lease must expire before a new sync may write.
    const blocked = await new GmailInboxSync(credentialSource().source, store, scope, g.fetcher, small, () => NOW).fullSync();
    assert.equal(blocked.outcome, "busy");
    store.close();
    const later = new InboxStore(path, () => NOW + 10 * 60_000);
    const r = await new GmailInboxSync(credentialSource().source, later, scope, g.fetcher, small, () => NOW + 10 * 60_000).fullSync();
    assert.equal(r.outcome, "complete");
    assert.deepEqual(later.messageIds(ns), mailbox(20).map((m) => m.id));
    later.close();
  } finally {
    child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }
});

test("account change mid-sync: blocked, nothing written after the change, other account gets its own namespace", async () => {
  const f = setup(mailbox(9), {
    onRequest: (path: string) => { if (path.includes("m0004?format=full")) f.c.state.cred = credential({ subject: "account-two", account: "otro@example.test" }); },
  });
  try {
    const r = await f.sync.fullSync();
    assert.equal(r.outcome, "blocked");
    assert.equal(r.code, "GMAIL_ACCOUNT_CHANGED");
    const written = f.store.messageIds(ns);
    assert.ok(!written.includes("m0004") && !written.includes("m0005"));
    assert.equal(f.store.namespace(ns)!.historyId, null);
    assert.equal(f.store.namespace(ns)!.syncState, "blocked");
    // The profile check also guards the account: a mismatching profile is refused.
    assert.equal((await f.sync.fullSync()).code, "GMAIL_ACCOUNT_CHANGED");
    const g2 = fakeGmail(mailbox(9), { email: "otro@example.test" });
    const r2 = await new GmailInboxSync(f.c.source, f.store, scope, g2.fetcher, small, () => NOW).fullSync();
    assert.equal(r2.outcome, "complete");
    const ns2 = inboxNamespace("agency", "owner", "account-two");
    assert.equal(r2.ns, ns2);
    assert.notEqual(ns2, ns);
    assert.ok(f.store.messageIds(ns2).length > 0);
    assert.deepEqual(f.store.messageIds(ns), written); // first namespace untouched
  } finally {
    f.done();
  }
});

test("disconnect during fetch: in-flight batch is not written, blocked, no cursor", async () => {
  const f = setup(mailbox(9), {
    onRequest: (path: string) => { if (path.includes("m0004?format=full")) f.c.state.cred = null; },
  });
  try {
    const r = await f.sync.fullSync();
    assert.equal(r.outcome, "blocked");
    assert.equal(r.code, "GMAIL_NOT_CONNECTED");
    const written = f.store.messageIds(ns);
    assert.equal(written.length % 3, 0); // only whole batches written before the disconnect
    assert.ok(!written.includes("m0004"));
    assert.equal(f.store.namespace(ns)!.historyId, null);
  } finally {
    f.done();
  }
});

test("concurrent syncs: same store and a second connection to the same file get busy; stale lease cannot write", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const f = setup(mailbox(6), { onRequest: async (path: string) => { if (path.includes("format=full")) await gate; } });
  try {
    const first = f.sync.fullSync();
    await new Promise((r) => setTimeout(r, 20));
    const sameStore = await new GmailInboxSync(f.c.source, f.store, scope, f.g.fetcher, small, () => NOW).fullSync();
    assert.equal(sameStore.outcome, "busy");
    const otherConn = new InboxStore(f.path, () => NOW);
    assert.equal((await new GmailInboxSync(f.c.source, otherConn, scope, f.g.fetcher, small, () => NOW).fullSync()).outcome, "busy");
    otherConn.close();
    release();
    assert.equal((await first).outcome, "complete");
    // Fencing: a holder whose lease expired and was taken over cannot write.
    let clock = NOW;
    const s = new InboxStore(f.path, () => clock);
    const t1 = s.acquireLease(ns, 1000)!;
    clock += 5000;
    const t2 = s.acquireLease(ns, 1000);
    assert.ok(t2);
    assert.throws(() => s.renewLease(ns, t1, 1000), (e: unknown) => e instanceof InboxStoreError && e.message === "INBOX_LEASE_LOST");
    s.close();
  } finally {
    f.done();
  }
});

test("missing gmail.readonly: blocked before any request", async () => {
  const f = setup(mailbox(3));
  f.c.state.cred = credential({ scopes: [GMAIL_SEND_SCOPE, "openid", "email"] });
  try {
    const r = await f.sync.fullSync();
    assert.equal(r.code, "GMAIL_READ_SCOPE_MISSING");
    assert.equal(f.g.counts.total, 0);
  } finally {
    f.done();
  }
});

for (const [status, outcome, code] of [
  [401, "blocked", "GMAIL_AUTHORIZATION_REQUIRED"],
  [403, "blocked", "GMAIL_AUTHORIZATION_REQUIRED"],
  [429, "paused", "GMAIL_RATE_LIMITED"],
  [503, "paused", "GMAIL_UNAVAILABLE"],
] as const)
  test(`HTTP ${status} on listing → ${outcome}, no cursor`, async () => {
    const f = setup(mailbox(3), { failOnce: (path: string) => (path.startsWith("messages?") ? status : null) });
    try {
      const r = await f.sync.fullSync();
      assert.equal(r.outcome, outcome);
      assert.equal(r.code, code);
      assert.equal(f.store.namespace(ns)!.historyId, null);
    } finally {
      f.done();
    }
  });

test("oversized full response falls back to headers-only metadata, marked too_large", async () => {
  const msgs = mailbox(3);
  msgs[1]!.bigBytes = 300_000;
  const f = setup(msgs, {}, { ...small, fullResponseMaxBytes: 100_000 });
  try {
    assert.equal((await f.sync.fullSync()).outcome, "complete");
    const m = f.store.message(ns, "m0001")!;
    assert.equal(m.bodySource, "too_large");
    assert.equal(m.bodyText, "");
    assert.equal(m.bodyTruncated, true);
    assert.equal(m.subject, "Asunto 1");
    assert.equal(f.g.counts.metadata, 1);
  } finally {
    f.done();
  }
});

test("enumeration above maxCandidates blocks without selecting or confirming a cursor", async () => {
  const f = setup(mailbox(30), {}, { ...small, maxCandidates: 10, selectionCap: 5 });
  try {
    const r = await f.sync.fullSync();
    assert.equal(r.outcome, "blocked");
    assert.equal(r.code, "INBOX_ENUMERATION_LIMIT");
    assert.equal(f.store.messageIds(ns).length, 0);
    assert.equal(f.store.namespace(ns)!.historyId, null);
  } finally {
    f.done();
  }
});

test("message deleted between listing and get is skipped; run completes", async () => {
  const msgs = mailbox(5);
  let removed = false;
  const f = setup(msgs, {
    onRequest: (path: string) => { if (!removed && path.includes("format=full")) { removed = true; msgs.splice(msgs.findIndex((m) => m.id === "m0004"), 1); } },
  });
  try {
    assert.equal((await f.sync.fullSync()).outcome, "complete");
    assert.equal(f.store.messageIds(ns).includes("m0004"), false);
  } finally {
    f.done();
  }
});

test("a run older than maxRunAgeMs is abandoned and restarts with a new H0", async () => {
  let h = 100, clock = NOW;
  const msgs = mailbox(12);
  const dir = mkdtempSync(join(tmpdir(), "p03-age-")), path = join(dir, "inbox.db");
  const g = fakeGmail(msgs, { historyId: () => String(h++) });
  const store = new InboxStore(path, () => clock);
  const opts = { ...small, maxCandidates: 12, selectionCap: 12, maxRequestsPerRun: 12 };
  try {
    const r1 = await new GmailInboxSync(credentialSource().source, store, scope, g.fetcher, opts, () => clock).fullSync();
    assert.equal(r1.outcome, "paused");
    clock += 6 * DAY;
    let r = await new GmailInboxSync(credentialSource().source, store, scope, g.fetcher, opts, () => clock).fullSync();
    assert.notEqual(r.runId, r1.runId);
    while (r.outcome === "paused") r = await new GmailInboxSync(credentialSource().source, store, scope, g.fetcher, opts, () => clock).fullSync();
    assert.equal(store.namespace(ns)!.historyId, "101");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("schema newer than supported is rejected", () => {
  const dir = mkdtempSync(join(tmpdir(), "p03-schema-")), path = join(dir, "inbox.db");
  try {
    new InboxStore(path).close();
    const db = new DatabaseSync(path);
    db.prepare("UPDATE inbox_meta SET value='99' WHERE key='schema_version'").run();
    db.close();
    assert.throws(() => new InboxStore(path), /INBOX_SCHEMA_TOO_NEW/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("D3 contract: purge removes this namespace's inbox data and cursor only, refuses during a sync", async () => {
  const f = setup(mailbox(4));
  try {
    await f.sync.fullSync();
    const t = f.store.acquireLease(ns, 60_000)!;
    assert.throws(() => f.store.purgeNamespace(ns), /INBOX_SYNC_ACTIVE/);
    f.store.releaseLease(ns, t);
    f.store.purgeNamespace(ns);
    assert.equal(f.store.messageIds(ns).length, 0);
    const n = f.store.namespace(ns)!;
    assert.equal(n.historyId, null);
    assert.equal(n.syncState, "never");
  } finally {
    f.done();
  }
});

test("no tokens or client secrets in the inbox database files", async () => {
  const f = setup(mailbox(5));
  try {
    await f.sync.fullSync();
    f.store.close();
    for (const file of readdirSync(f.dir)) {
      const bytes = readFileSync(join(f.dir, file));
      for (const secret of ["synthetic-access-token-p03", "synthetic-refresh-p03", "synthetic-client-secret-p03", "Bearer"])
        assert.equal(bytes.includes(Buffer.from(secret)), false, file + " contains " + secret);
    }
  } finally {
    f.done();
  }
});

test("structural: inbox modules hold no send capability", () => {
  for (const file of ["gmail-inbox-sync.ts", "inbox-store.ts", "inbox-mime.ts"]) {
    const src = readFileSync(new URL("../src/" + file, import.meta.url), "utf8");
    assert.doesNotMatch(src, /gmail-email-provider|email-governance|email-workflow|messages\/send|"POST"|'POST'/, file);
  }
});

test("lease is renewed per request, so a slow batch longer than the TTL still commits", async () => {
  let clock = NOW;
  const dir = mkdtempSync(join(tmpdir(), "p03-ttl-")), path = join(dir, "inbox.db");
  const g = fakeGmail(mailbox(6), { onRequest: () => { clock += 50_000; } }); // each request "takes" 50 s
  const store = new InboxStore(path, () => clock);
  try {
    const r = await new GmailInboxSync(credentialSource().source, store, scope, g.fetcher, { ...small, leaseTtlMs: 120_000 }, () => clock).fullSync();
    assert.equal(r.outcome, "complete");
    assert.equal(store.messageIds(ns).length, 6);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
