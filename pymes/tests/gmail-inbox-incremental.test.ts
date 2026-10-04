import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fork } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { InboxStore, inboxNamespace } from "../src/inbox-store.js";
import { InboxService } from "../src/inbox-service.js";
import { historyGmail, msg, credentialSource, NOW, DAY } from "./fixtures/gmail-history-fake.js";
import { initialMessages, scenarioAfterExpiry, scenarioIncremental, P04_SCOPE, P04_OPTIONS } from "./fixtures/inbox-p04-scenarios.js";
import { credential } from "./fixtures/gmail-inbox-fake.js";

const ns = inboxNamespace("agency", "owner", "account-one");
async function untilIdle(service: InboxService, max = 40) {
  let last;
  for (let i = 0; i < max; i++) {
    last = await service.syncNow();
    const info = service.store.namespaceInfo(ns)!;
    if (last.outcome === "complete" && !info.catchupPending && !info.resyncRequired && !info.incrementalActive && !info.fullRunActive) return last;
  }
  throw new Error("did not converge: " + JSON.stringify(last));
}
function setup(messages = initialMessages(), opts: Parameters<typeof historyGmail>[1] = {}, serviceOptions: Partial<import("../src/inbox-service.js").InboxServiceOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "p04-")), path = join(dir, "inbox.db");
  const g = historyGmail(messages, opts), c = credentialSource();
  const store = new InboxStore(path, () => NOW);
  const service = new InboxService(c.source, store, P04_SCOPE, g.fetcher, { ...P04_OPTIONS, ...serviceOptions }, () => NOW);
  return { dir, path, g, c, store, service, done: () => { try { store.close(); } catch {} rmSync(dir, { recursive: true, force: true }); } };
}
const raw = (path: string, id: string) => {
  const db = new DatabaseSync(path);
  const r = db.prepare("SELECT * FROM inbox_message WHERE gmail_id=?").get(id) as Record<string, unknown>;
  const a = (db.prepare("SELECT COUNT(*) n FROM inbox_attachment WHERE gmail_id=?").get(id) as { n: number }).n;
  db.close();
  return { ...r, attachments: a } as Record<string, unknown>;
};

test("incremental applies add, delete, archive, spam and un-archive by current state; cursor published once at the end", async () => {
  const f = setup();
  try {
    await untilIdle(f.service);
    assert.equal(f.store.namespaceInfo(ns)!.historyId, "1000");
    f.g.add(msg("new1"));
    f.g.remove("r00");
    f.g.setLabels("r01", []); // archived in Gmail
    f.g.setLabels("r02", ["SPAM"]);
    f.g.setLabels("r03", []);
    f.g.setLabels("r03", ["INBOX"]); // archived then back: duplicate, out-of-order events are fine
    await untilIdle(f.service);
    const info = f.store.namespaceInfo(ns)!;
    assert.equal(info.historyId, f.g.historyId);
    assert.equal(info.catchupPending, false);
    assert.equal(f.service.status(await f.service.context(null)).state, "up_to_date");
    assert.equal(f.store.messageDetail(ns, "new1")!.bodyText, "Cuerpo new1");
    for (const gone of ["r00", "r02"]) {
      assert.equal(f.store.messageDetail(ns, gone), null);
      const r = raw(f.path, gone);
      assert.equal(r.scope_state, "deleted");
      assert.deepEqual([r.body_text, r.snippet, r.subject_h, r.from_h, r.attachments], ["", null, null, null, 0]);
    }
    assert.deepEqual(f.store.listMessages(ns, { scope: "archived", query: "", cursor: null, limit: 50 }).items.map((m) => m.gmailId), ["r01"]);
    const inbox = f.store.listMessages(ns, { scope: "inbox", query: "", cursor: null, limit: 50 }).items.map((m) => m.gmailId);
    assert.ok(inbox.includes("r03") && inbox.includes("new1") && !inbox.includes("r00") && !inbox.includes("r02") && !inbox.includes("r01"));
    assert.equal(f.store.listMessages(ns, { scope: "inbox", query: "r02", cursor: null, limit: 50 }).items.length, 0);
  } finally {
    f.done();
  }
});

test("spam/trash back to INBOX restores the body even outside the window; unknown old messages are not imported", async () => {
  const old = msg("old1", { internalDate: NOW - 200 * DAY, labels: ["INBOX"] });
  const f = setup([...initialMessages()]);
  try {
    await untilIdle(f.service);
    f.g.setLabels("r04", ["TRASH"]);
    await untilIdle(f.service);
    assert.equal(raw(f.path, "r04").body_text, "");
    // pretend r04 is old: restore must not depend on the window
    f.g.messages.find((m) => m.id === "r04")!.internalDate = NOW - 300 * DAY;
    f.g.setLabels("r04", ["INBOX"]);
    f.g.add(old); // unknown and older than the 90-day window
    await untilIdle(f.service);
    assert.equal(f.store.messageDetail(ns, "r04")!.bodyText, "Cuerpo r04");
    assert.equal(f.store.messageDetail(ns, "old1"), null);
    assert.equal((raw(f.path, "old1") as Record<string, unknown>).gmail_id, undefined); // never stored
  } finally {
    f.done();
  }
});

test("small budget: incremental progresses across invocations, cursor stays until everything is listed and reconciled", async () => {
  const f = setup(initialMessages(), {}, { incremental: { historyPageSize: 2, batchSize: 2, maxRequestsPerRun: 4 } });
  try {
    await untilIdle(f.service);
    for (let i = 0; i < 9; i++) f.g.add(msg("b" + i));
    const progress: number[] = [];
    let calls = 0;
    while (true) {
      const r = await f.service.syncNow();
      calls++;
      const info = f.store.namespaceInfo(ns)!, run = f.store.incrementalRun(ns);
      if (!run) { assert.equal(r.outcome, "complete"); break; }
      assert.equal(info.historyId, "1000"); // never published early
      progress.push(run.pages * 1000 + (run.touched - run.pending));
      assert.ok(calls < 30);
    }
    assert.ok(progress.every((p, i) => i === 0 || p > progress[i - 1]!)); // strictly advancing
    assert.ok(calls > 3);
    assert.equal(f.store.namespaceInfo(ns)!.historyId, f.g.historyId);
    for (let i = 0; i < 9; i++) assert.ok(f.store.messageDetail(ns, "b" + i));
  } finally {
    f.done();
  }
});

test("changes made during reconciliation are not skipped: cursor is the enumerated target, next run sees them", async () => {
  let armed = false;
  const f = setup(initialMessages(), { onRequest: (p) => { if (armed && p.includes("fields=id,labelIds,internalDate")) { armed = false; f.g.add(msg("late")); } } });
  try {
    await untilIdle(f.service);
    f.g.add(msg("first"));
    const target = f.g.historyId;
    armed = true;
    await f.service.syncNow();
    assert.equal(f.store.namespaceInfo(ns)!.historyId, target); // not the later profile/history id
    assert.notEqual(f.g.historyId, target);
    assert.equal(f.store.messageDetail(ns, "late"), null);
    await untilIdle(f.service);
    assert.ok(f.store.messageDetail(ns, "late"));
  } finally {
    f.done();
  }
});

test("invalid history pages fail without moving the cursor: missing historyId, bad ids, repeated token, huge response", async () => {
  for (const bad of [
    { history: [] },
    { history: [{ messagesAdded: [{ message: { id: "bad id" } }] }], historyId: "2000" },
    { history: "x", historyId: "2000" },
    { historyId: 2000 },
  ]) {
    const f = setup();
    try {
      await untilIdle(f.service);
      f.g.add(msg("x"));
      const transport = f.g.fetcher;
      const s2 = new InboxService(f.c.source, f.store, P04_SCOPE, async (i, o) => String(i).includes("/history") ? new Response(JSON.stringify(bad)) : transport(i, o), P04_OPTIONS, () => NOW);
      const r = await s2.syncNow();
      assert.equal(r.outcome, "failed");
      assert.equal(r.code, "GMAIL_HISTORY_INVALID");
      assert.equal(f.store.namespaceInfo(ns)!.historyId, "1000");
    } finally {
      f.done();
    }
  }
  const f = setup();
  try {
    await untilIdle(f.service);
    const transport = f.g.fetcher;
    const s2 = new InboxService(f.c.source, f.store, P04_SCOPE, async (i, o) => String(i).includes("/history") ? new Response(JSON.stringify({ historyId: "2000", nextPageToken: "same" })) : transport(i, o), P04_OPTIONS, () => NOW);
    let r = await s2.syncNow();
    if (r.code !== "INBOX_HISTORY_PAGINATION_INVALID") r = await s2.syncNow();
    assert.equal(r.code, "INBOX_HISTORY_PAGINATION_INVALID");
    assert.equal(f.store.namespaceInfo(ns)!.historyId, "1000");
    const s3 = new InboxService(f.c.source, f.store, P04_SCOPE, async (i, o) => String(i).includes("/history") ? new Response(JSON.stringify({ historyId: "2000", pad: "x".repeat(2_000_000) })) : transport(i, o), P04_OPTIONS, () => NOW);
    assert.equal((await s3.syncNow()).code, "GMAIL_RESPONSE_TOO_LARGE");
  } finally {
    f.done();
  }
});

test("errors are never absence: 403/429/5xx/invalid JSON on a touched id keep it pending and the cursor unchanged", async () => {
  for (const [status, outcome] of [[403, "blocked"], [429, "paused"], [503, "paused"], [200, "failed"]] as const) {
    let fail = false;
    const f = setup(initialMessages(), {});
    try {
      await untilIdle(f.service);
      f.g.remove("r05");
      fail = true;
      const transport = f.g.fetcher;
      const s2 = new InboxService(f.c.source, f.store, P04_SCOPE, async (i, o) => fail && String(i).includes("r05?format=full&fields") ? (status === 200 ? new Response("{broken") : new Response("{}", { status })) : transport(i, o), P04_OPTIONS, () => NOW);
      const r = await s2.syncNow();
      assert.equal(r.outcome, outcome);
      assert.ok(f.store.messageDetail(ns, "r05")); // not treated as deleted
      assert.equal(f.store.namespaceInfo(ns)!.historyId, "1000");
    } finally {
      f.done();
    }
  }
});

test("expired cursor (404): resync reconciles local deleted/archived/spam rows, keeps rows only outside the cap, then catches up", async () => {
  const messages = initialMessages();
  const f = setup(messages, {}, { sync: { ...P04_OPTIONS.sync, selectionCap: 50 } });
  try {
    await untilIdle(f.service);
    // Gmail changes invisible to our cursor, then the cursor expires.
    f.g.silently(() => {
      messages.splice(messages.findIndex((m) => m.id === "r01"), 1);
      messages.find((m) => m.id === "r02")!.labels = [];
      messages.find((m) => m.id === "r03")!.labels = ["SPAM"];
    });
    f.g.expire();
    // A cap smaller than the mailbox: older INBOX rows fall outside the new selection but must not be deleted.
    const capped = new InboxService(f.c.source, f.store, P04_SCOPE, f.g.fetcher, { ...P04_OPTIONS, sync: { ...P04_OPTIONS.sync, selectionCap: 4 }, incremental: { ...P04_OPTIONS.incremental, maxRequestsPerRun: 5 } }, () => NOW);
    let sawResync = false, sawPartial = false;
    for (let i = 0; i < 60; i++) {
      const r = await capped.syncNow();
      if (r.steps.includes("full") && r.steps[0] === "incremental") sawResync = true;
      const info = f.store.namespaceInfo(ns)!;
      if (info.resyncRequired) { sawPartial = true; assert.equal(capped.status(await capped.context(null)).state, "resync"); }
      if (!info.resyncRequired && !info.catchupPending && !info.fullRunActive && sawResync) break;
    }
    assert.ok(sawPartial); // budget forces at least one observable partial state
    assert.ok(sawResync);
    const info = f.store.namespaceInfo(ns)!;
    assert.equal(info.resyncRequired, false);
    assert.equal(info.catchupPending, false);
    assert.equal(info.syncState, "complete_truncated");
    assert.equal(f.store.messageDetail(ns, "r01"), null);
    assert.equal(raw(f.path, "r01").scope_state, "deleted");
    assert.equal(f.store.messageDetail(ns, "r02")!.scopeState, "archived");
    assert.equal(raw(f.path, "r03").scope_state, "deleted");
    for (const keep of ["r08", "r09", "r10", "r11"]) assert.equal(f.store.messageDetail(ns, keep)!.scopeState, "active"); // outside the cap, still in INBOX
    assert.equal(capped.status(await capped.context(null)).state, "up_to_date");
  } finally {
    f.done();
  }
});

test("too many touched ids triggers resync instead of an unbounded run", async () => {
  const f = setup(initialMessages(), {}, { incremental: { ...P04_OPTIONS.incremental, maxTouched: 3, maxRequestsPerRun: 50 } });
  try {
    await untilIdle(f.service);
    for (let i = 0; i < 6; i++) f.g.add(msg("o" + i));
    await f.service.syncNow();
    assert.ok(f.store.namespaceInfo(ns)!.resyncRequired || f.store.namespaceInfo(ns)!.historyId !== "1000");
    await untilIdle(f.service, 80);
    for (let i = 0; i < 6; i++) assert.ok(f.store.messageDetail(ns, "o" + i));
  } finally {
    f.done();
  }
});

test("CAS: a concurrent writer that moved the cursor makes publication fail without overwriting", async () => {
  const f = setup();
  try {
    await untilIdle(f.service);
    f.g.add(msg("cas1"));
    const other = new DatabaseSync(f.path); // a second connection, as another process would use
    let moved = false;
    const transport = f.g.fetcher;
    const s2 = new InboxService(f.c.source, f.store, P04_SCOPE, async (i, o) => {
      if (!moved && String(i).includes("fields=id,labelIds,internalDate")) { moved = true; other.prepare("UPDATE inbox_namespace SET history_id='999999' WHERE ns=?").run(ns); }
      return transport(i, o);
    }, P04_OPTIONS, () => NOW);
    const r = await s2.syncNow();
    other.close();
    assert.equal(r.code, "INBOX_CURSOR_CONFLICT");
    assert.equal(f.store.namespaceInfo(ns)!.historyId, "999999");
  } finally {
    f.done();
  }
});

test("another process holding the lease: sync is busy; nothing is written", { timeout: 30000 }, async () => {
  const f = setup();
  try {
    await untilIdle(f.service);
    const child = fork(new URL("./fixtures/inbox-p04-lease.ts", import.meta.url), [f.path], { execArgv: process.execArgv, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    try {
      await once(child, "message");
      f.g.add(msg("blocked1"));
      const r = await f.service.syncNow();
      assert.equal(r.outcome, "busy");
      assert.equal(f.store.messageDetail(ns, "blocked1"), null);
    } finally {
      child.kill("SIGKILL");
      await once(child, "exit").catch(() => undefined);
    }
  } finally {
    f.done();
  }
});

for (const mode of ["resync", "incremental"] as const)
  test(`SIGKILL during ${mode} reconciliation: restart resumes without redoing finished work and converges`, { timeout: 40000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "p04-kill-")), path = join(dir, "inbox.db");
    try {
      const first = new InboxStore(path, () => NOW);
      const init = historyGmail(initialMessages());
      await untilIdle(new InboxService(credentialSource().source, first, P04_SCOPE, init.fetcher, P04_OPTIONS, () => NOW));
      first.close();
      const child = fork(new URL("./fixtures/inbox-p04-crash.ts", import.meta.url), [path, mode, mode === "resync" ? "2" : "5"], { execArgv: process.execArgv, stdio: ["ignore", "ignore", "pipe", "ipc"] });
      let errors = "";
      child.stderr?.on("data", (c) => (errors += c));
      const [message] = (await Promise.race([once(child, "message"), new Promise((_, reject) => { setTimeout(() => reject(new Error("WAIT " + errors)), 30000).unref(); })])) as [string];
      assert.equal(message, "hanging");
      child.kill("SIGKILL");
      await once(child, "exit").catch(() => undefined);
      const later = NOW + 10 * 60_000;
      const store = new InboxStore(path, () => later);
      const before = mode === "resync" ? store.resyncActive(ns) : store.incrementalRun(ns);
      assert.ok(before); // durable work list survived the kill
      if (mode === "resync") assert.equal(store.namespaceInfo(ns)!.resyncRequired, true);
      else assert.equal(store.namespaceInfo(ns)!.historyId, "1000");
      const g = mode === "resync" ? scenarioAfterExpiry() : scenarioIncremental();
      const service = new InboxService(credentialSource().source, store, P04_SCOPE, g.fetcher, P04_OPTIONS, () => later);
      for (let i = 0; i < 60 && (store.namespaceInfo(ns)!.resyncRequired || store.namespaceInfo(ns)!.catchupPending || store.incrementalRun(ns)); i++) await service.syncNow();
      const info = store.namespaceInfo(ns)!;
      assert.equal(info.resyncRequired, false);
      assert.equal(info.catchupPending, false);
      if (mode === "resync") {
        assert.equal(store.messageDetail(ns, "r01"), null);
        assert.equal(store.messageDetail(ns, "r02")!.scopeState, "archived");
        assert.equal(store.messageDetail(ns, "r03"), null);
      } else for (let i = 0; i < 8; i++) assert.ok(store.messageDetail(ns, "n" + i));
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

test("v2 → v3 migration keeps messages, quality, paused runs and lets the P03 full sync resume", async () => {
  const dir = mkdtempSync(join(tmpdir(), "p04-mig-")), path = join(dir, "inbox.db");
  try {
    const g = historyGmail(initialMessages());
    let store = new InboxStore(path, () => NOW);
    const s = new InboxService(credentialSource().source, store, P04_SCOPE, g.fetcher, { ...P04_OPTIONS, sync: { ...P04_OPTIONS.sync, maxCandidates: 12, selectionCap: 12, maxRequestsPerRun: 12 } }, () => NOW);
    const r1 = await s.syncNow();
    assert.notEqual(r1.outcome, "complete"); // paused mid full sync
    const storedBefore = store.messageIds(ns);
    store.close();
    // Downgrade the file to the P03 v2 layout.
    const db = new DatabaseSync(path);
    db.exec("DROP INDEX IF EXISTS inbox_namespace_ref; DROP INDEX IF EXISTS inbox_message_order; DROP INDEX IF EXISTS inbox_namespace_owner;");
    for (const [t, c] of [["inbox_message", "scope_state"], ["inbox_message", "scope_changed_at"], ["inbox_message", "confirmed_at"], ["inbox_namespace", "account_ref"], ["inbox_namespace", "revision"], ["inbox_namespace", "resync_required"], ["inbox_namespace", "auto_sync_paused"], ["inbox_namespace", "window_start_ms"], ["inbox_namespace", "last_sync_at"], ["inbox_namespace", "next_sync_at"], ["inbox_namespace", "backoff_ms"]])
      db.exec(`ALTER TABLE ${t} DROP COLUMN ${c}`);
    db.exec("DROP TABLE inbox_incremental; DROP TABLE inbox_touched; DROP TABLE inbox_resync; DROP TABLE inbox_resync_local; DROP TABLE inbox_purge_token;");
    db.prepare("UPDATE inbox_meta SET value='2' WHERE key='schema_version'").run();
    db.close();
    store = new InboxStore(path, () => NOW);
    assert.deepEqual(store.messageIds(ns), storedBefore);
    assert.match(store.namespaceInfo(ns)!.accountRef, /^[a-f0-9]{32}$/);
    assert.ok(store.activeRun(ns));
    const s2 = new InboxService(credentialSource().source, store, P04_SCOPE, g.fetcher, { ...P04_OPTIONS, sync: { ...P04_OPTIONS.sync, maxCandidates: 12, selectionCap: 12, maxRequestsPerRun: 12 } }, () => NOW);
    await untilIdle(s2);
    assert.equal(store.messageIds(ns).length, 12);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("structural: P04a modules hold no send capability", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of ["gmail-inbox-incremental.ts", "inbox-service.ts", "gmail-inbox-api.ts", "inbox-store.ts"]) {
    const src = readFileSync(new URL("../src/" + file, import.meta.url), "utf8");
    assert.doesNotMatch(src, /gmail-email-provider|email-governance|email-workflow|messages\/send|method:\s*"POST"/, file);
  }
});
void credential;
