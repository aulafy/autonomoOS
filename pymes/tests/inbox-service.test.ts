import test from "node:test";
import assert from "node:assert/strict";
import { InboxStore, inboxNamespace } from "../src/inbox-store.js";
import { InboxService } from "../src/inbox-service.js";
import { historyGmail, msg, credentialSource, NOW } from "./fixtures/gmail-history-fake.js";
import { initialMessages, P04_SCOPE, P04_OPTIONS } from "./fixtures/inbox-p04-scenarios.js";
import { credential } from "./fixtures/gmail-inbox-fake.js";
const ns = inboxNamespace("agency", "owner", "account-one");
function fakeTimers() {
  const pending: { fn: () => void; ms: number; cleared: boolean }[] = [];
  return { pending, timers: { set: (fn: () => void, ms: number) => { const h = { fn, ms, cleared: false }; pending.push(h); return h; }, clear: (h: unknown) => { (h as { cleared: boolean }).cleared = true; } } };
}

test("start() twice creates one timer; after a tick exactly one next timer is pending", async () => {
  const g = historyGmail(initialMessages()), store = new InboxStore(":memory:", () => NOW), t = fakeTimers();
  const s = new InboxService(credentialSource().source, store, P04_SCOPE, g.fetcher, P04_OPTIONS, () => NOW, t.timers);
  try {
    s.start(); s.start();
    assert.equal(t.pending.length, 1);
    t.pending[0]!.fn();
    for (let i = 0; i < 50 && t.pending.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(t.pending.length, 2);
    assert.equal(t.pending[1]!.ms, 300_000); // next automatic tick in 5 minutes
    assert.ok(store.namespaceInfo(ns)?.historyId);
  } finally {
    await s.close();
    assert.ok(t.pending.at(-1)!.cleared);
    store.close();
  }
});

test("authorization block waits for a new credential generation; enumeration limit is not reported as reconnect", async () => {
  let deny = true;
  const g = historyGmail(initialMessages()), store = new InboxStore(":memory:", () => NOW), c = credentialSource();
  const transport: typeof fetch = async (i, o) => deny && String(i).includes("messages?") ? new Response("{}", { status: 401 }) : g.fetcher(i, o);
  const s = new InboxService(c.source, store, P04_SCOPE, transport, P04_OPTIONS, () => NOW);
  try {
    const r = await s.tick();
    assert.equal(r.code, "GMAIL_AUTHORIZATION_REQUIRED");
    assert.equal(s.status(await s.context(null)).state, "needs_reconnect");
    deny = false;
    const before = g.counts.total;
    assert.equal((await s.tick()).outcome, "idle"); // same generation: no requests
    assert.equal(g.counts.total, before);
    c.state.cred = credential({ generation: "d".repeat(64) }); // reconnection completed
    assert.equal((await s.tick()).outcome, "complete");
  } finally {
    await s.close();
    store.close();
  }
  const store2 = new InboxStore(":memory:", () => NOW);
  const s2 = new InboxService(credentialSource().source, store2, P04_SCOPE, historyGmail(initialMessages()).fetcher, { ...P04_OPTIONS, sync: { ...P04_OPTIONS.sync, maxCandidates: 5, selectionCap: 5 } }, () => NOW);
  try {
    assert.equal((await s2.syncNow()).code, "INBOX_ENUMERATION_LIMIT");
    const view = s2.status(await s2.context(null));
    assert.equal(view.state, "limit");
    assert.equal(view.errorCategory, "limit");
  } finally {
    await s2.close();
    store2.close();
  }
});

test("429 backoff is durable, doubles, is capped and survives a restart; manual sync bypasses it", async () => {
  let clock = NOW, limited = false;
  const g = historyGmail(initialMessages()), store = new InboxStore(":memory:", () => clock);
  const transport: typeof fetch = async (i, o) => limited && String(i).includes("/history") ? new Response("{}", { status: 429 }) : g.fetcher(i, o);
  const opts = { ...P04_OPTIONS, minBackoffMs: 60_000, maxBackoffMs: 100_000 };
  const s = new InboxService(credentialSource().source, store, P04_SCOPE, transport, opts, () => clock);
  try {
    await s.syncNow();
    limited = true;
    await s.tick();
    assert.equal(store.namespaceInfo(ns)!.backoffMs, 60_000);
    assert.equal(store.namespaceInfo(ns)!.nextSyncAt, clock + 60_000);
    assert.equal((await s.tick()).code, "INBOX_BACKOFF");
    assert.equal(s.status(await s.context(null)).state, "waiting_retry");
    const restarted = new InboxService(credentialSource().source, store, P04_SCOPE, transport, opts, () => clock);
    assert.equal((await restarted.tick()).code, "INBOX_BACKOFF");
    clock += 61_000;
    await s.tick();
    assert.equal(store.namespaceInfo(ns)!.backoffMs, 100_000); // doubled, capped
    limited = false;
    assert.equal((await s.syncNow()).outcome, "complete");
    assert.equal(store.namespaceInfo(ns)!.backoffMs, 0);
  } finally {
    await s.close();
    store.close();
  }
});

test("cancel() aborts and waits until the lease is released; close() stops everything", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  let block = false;
  const g = historyGmail(initialMessages(), { onRequest: async (p) => { if (block && p.startsWith("history")) await gate; } });
  const store = new InboxStore(":memory:", () => NOW);
  const s = new InboxService(credentialSource().source, store, P04_SCOPE, g.fetcher, P04_OPTIONS, () => NOW);
  try {
    await s.syncNow();
    block = true;
    const running = s.syncNow();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(s.isRunning, true);
    let cancelled = false;
    const cancel = s.cancel().then(() => (cancelled = true));
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(cancelled, false); // still waiting for the step
    release();
    await cancel;
    await running;
    assert.equal(s.isRunning, false);
    const token = store.acquireLease(ns, 1000);
    assert.ok(token); // lease was released
    store.releaseLease(ns, token!);
  } finally {
    await s.close();
    store.close();
  }
});

test("purge pause survives restart and ticks; only an explicit manual sync re-imports", async () => {
  const g = historyGmail(initialMessages()), store = new InboxStore(":memory:", () => NOW);
  const s = new InboxService(credentialSource().source, store, P04_SCOPE, g.fetcher, P04_OPTIONS, () => NOW);
  try {
    await s.syncNow();
    const info = store.namespaceInfo(ns)!;
    const t = s.createPurgeConfirmation(info);
    await s.purge(info, t.confirmationId, () => true);
    assert.equal(store.messageIds(ns).length, 0);
    assert.equal((await s.tick()).code, "INBOX_AUTO_SYNC_PAUSED");
    const restarted = new InboxService(credentialSource().source, store, P04_SCOPE, g.fetcher, P04_OPTIONS, () => NOW);
    assert.equal((await restarted.tick()).code, "INBOX_AUTO_SYNC_PAUSED");
    assert.equal(restarted.status(await restarted.context(null)).state, "paused_after_purge");
    assert.equal(store.messageIds(ns).length, 0);
    assert.equal((await restarted.syncNow()).outcome, "complete");
    assert.equal(store.namespaceInfo(ns)!.autoSyncPaused, false);
    assert.ok(store.messageIds(ns).length > 0);
  } finally {
    await s.close();
    store.close();
  }
});

test("status: disconnected keeps stored data visible as not updated; never claims up to date", async () => {
  const g = historyGmail(initialMessages()), store = new InboxStore(":memory:", () => NOW), c = credentialSource();
  const s = new InboxService(c.source, store, P04_SCOPE, g.fetcher, { ...P04_OPTIONS, maxStepsPerRun: 1 }, () => NOW);
  try {
    await s.syncNow();
    assert.equal(s.status(await s.context(null)).state, "catching_up"); // full done, H0 catch-up still pending
    await s.syncNow();
    assert.equal(s.status(await s.context(null)).state, "up_to_date");
    c.state.cred = null;
    const ctx = await s.context(null);
    assert.equal(ctx.readable, true);
    const view = s.status(ctx);
    assert.equal(view.state, "disconnected");
    assert.equal(view.connected, false);
    assert.ok(view.messageCount > 0);
    assert.equal((await s.tick()).code, "GMAIL_NOT_CONNECTED");
    void msg;
  } finally {
    await s.close();
    store.close();
  }
});
