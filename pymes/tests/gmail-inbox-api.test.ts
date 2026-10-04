import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fork } from "node:child_process";
import { once } from "node:events";
import { WorkspaceApi, InMemoryWorkspaceRepository, type WorkspaceRuntimeSource } from "../src/workspace-api.js";
import { InboxStore, inboxNamespace } from "../src/inbox-store.js";
import { InboxService } from "../src/inbox-service.js";
import { historyGmail, msg, credentialSource, NOW } from "./fixtures/gmail-history-fake.js";
import { initialMessages, P04_SCOPE, P04_OPTIONS } from "./fixtures/inbox-p04-scenarios.js";
import { credential } from "./fixtures/gmail-inbox-fake.js";

const OWNER = "Bearer owner-token-123456";
function setup(path = ":memory:") {
  let clock = NOW;
  const g = historyGmail(initialMessages()), c = credentialSource();
  const store = new InboxStore(path, () => clock);
  const service = new InboxService(c.source, store, P04_SCOPE, g.fetcher, P04_OPTIONS, () => clock);
  const repo = new InMemoryWorkspaceRepository();
  const runtime: WorkspaceRuntimeSource = { gmailInbox: service, snapshotForTenant: () => null, principalIdForSession: (p) => p.userId };
  const api = new WorkspaceApi(repo, undefined, runtime);
  api.addSession("owner-token-123456", { userId: "owner", tenantId: "agency", role: "owner" });
  api.addSession("owner2-token-123456", { userId: "owner-2", tenantId: "agency", role: "owner" });
  api.addSession("agent-token-1234567", { userId: "owner", tenantId: "agency", role: "agent" });
  api.addSession("other-token-1234567", { userId: "owner", tenantId: "other", role: "owner" });
  const req = (method: "GET" | "POST", path: string, body?: unknown, auth = OWNER) =>
    api.handleAsync({ method, path: "/v1/workspaces/agency/gmail-inbox" + path, authorization: auth, body });
  return { g, c, store, service, repo, api, req, tick: (ms: number) => { clock += ms; }, done: async () => { await service.close(); store.close(); } };
}
const ns = inboxNamespace("agency", "owner", "account-one");

test("authorization: session, tenant, owner role and the configured owner only", async () => {
  const f = setup();
  try {
    assert.equal((await f.req("GET", "", undefined, "")).status, 401);
    assert.equal((await f.api.handleAsync({ method: "GET", path: "/v1/workspaces/agency/gmail-inbox", authorization: "Bearer other-token-1234567" })).status, 403);
    assert.equal((await f.req("GET", "", undefined, "Bearer agent-token-1234567")).status, 403);
    const second = await f.req("GET", "/messages", undefined, "Bearer owner2-token-123456");
    assert.equal(second.status, 403);
    assert.equal(second.body.error, "GMAIL_INBOX_OWNER_DENIED");
    const bare = new WorkspaceApi(new InMemoryWorkspaceRepository(), undefined, { snapshotForTenant: () => null, principalIdForSession: (p) => p.userId });
    bare.addSession("owner-token-123456", { userId: "owner", tenantId: "agency", role: "owner" });
    assert.equal((await bare.handleAsync({ method: "GET", path: "/v1/workspaces/agency/gmail-inbox", authorization: OWNER })).status, 404);
  } finally {
    await f.done();
  }
});

test("status, list and detail; client identity parameters are ignored; responses carry no secrets", async () => {
  const f = setup();
  try {
    const sync = await f.req("POST", "/sync", {});
    assert.equal(sync.status, 200);
    const status = await f.req("GET", "");
    assert.equal(status.body.state, "up_to_date");
    assert.deepEqual(status.body.window, { days: 90, cap: 50 }); // reflects configured cap (2000 in production defaults)
    assert.doesNotMatch(JSON.stringify(status.body), /synthetic|Bearer|refresh|secret/i);
    const list = await f.req("GET", "/messages?limit=5");
    const spoof = await f.req("GET", "/messages?limit=5&owner=owner-2&ns=" + "f".repeat(64) + "&subject=x");
    assert.deepEqual(spoof.body.items, list.body.items);
    const items = list.body.items as { gmailId: string }[];
    assert.equal(items.length, 5);
    const detail = await f.req("GET", "/messages/" + items[0]!.gmailId);
    assert.equal(detail.status, 200);
    assert.equal((detail.body.message as { bodyText: string }).bodyText, "Cuerpo " + items[0]!.gmailId);
    assert.ok((detail.body.context as { tag: string }).tag);
    assert.equal((await f.req("GET", "/messages/nope")).status, 404);
    assert.equal((await f.req("GET", "/messages/bad%20id")).status, 400);
    assert.equal((await f.req("GET", "?accountRef=xyz")).status, 400);
    assert.equal((await f.req("GET", "?accountRef=" + "0".repeat(32))).status, 404);
  } finally {
    await f.done();
  }
});

test("cursor is bound to account, scope and query; LIKE is escaped; NULL dates sort last", async () => {
  const f = setup();
  try {
    f.g.messages.push(msg("pct", { subject: "100% asegurado" }), msg("und", { subject: "a_b" }));
    await f.req("POST", "/sync", {});
    const first = await f.req("GET", "/messages?limit=3");
    const cursor = first.body.nextCursor as string;
    assert.ok(cursor);
    const second = await f.req("GET", "/messages?limit=3&cursor=" + encodeURIComponent(cursor));
    assert.equal(second.status, 200);
    const all = [...(first.body.items as { gmailId: string }[]), ...(second.body.items as { gmailId: string }[])].map((m) => m.gmailId);
    assert.equal(new Set(all).size, all.length); // keyset pages never overlap
    assert.equal((await f.req("GET", "/messages?limit=3&scope=sent&cursor=" + encodeURIComponent(cursor))).status, 400);
    assert.equal((await f.req("GET", "/messages?limit=3&q=x&cursor=" + encodeURIComponent(cursor))).status, 400);
    assert.equal((await f.req("GET", "/messages?cursor=garbage")).status, 400);
    assert.deepEqual(((await f.req("GET", "/messages?q=%25")).body.items as { gmailId: string }[]).map((m) => m.gmailId), ["pct"]);
    assert.deepEqual(((await f.req("GET", "/messages?q=_")).body.items as { gmailId: string }[]).map((m) => m.gmailId), ["und"]);
    // a row without internalDate sorts after every dated row
    const token = f.store.acquireLease(ns, 10_000)!;
    const parsed = { headers: { from: null, to: null, cc: null, replyTo: null, subject: "sin fecha", date: null, messageId: null, inReplyTo: null, references: null }, bodyText: "x", bodySource: "plain" as const, bodyTruncated: false, bodyUnavailable: false, charsetFallback: false, attachments: [], attachmentsTruncated: false, structureTruncated: false };
    f.store.applyState(ns, token, "nodate", { kind: "content", message: { gmailId: "nodate", threadId: null, internalDate: null, labels: ["INBOX"], snippet: null, sizeEstimate: null, parsed } }, {});
    f.store.releaseLease(ns, token);
    const everything = f.store.listMessages(ns, { scope: "inbox", query: "", cursor: null, limit: 50 }).items;
    assert.equal(everything.at(-1)!.gmailId, "nodate");
  } finally {
    await f.done();
  }
});

test("two accounts of the same owner: the other account's content is not readable while connected; purge by own ref; readable when disconnected", async () => {
  const f = setup();
  try {
    await f.req("POST", "/sync", {});
    const a = (await f.req("GET", "")).body.account as { accountRef: string };
    const aItem = ((await f.req("GET", "/messages?limit=1")).body.items as { gmailId: string }[])[0]!.gmailId;
    const tagA = ((await f.req("GET", "")).body.context as { tag: string }).tag;
    // connect account B (different subject) — profile email must match
    f.c.state.cred = credential({ subject: "account-two", account: "otro@example.test", generation: "e".repeat(64) });
    const gB = historyGmail([msg("b1"), msg("b2")], { email: "otro@example.test" });
    const serviceB = new InboxService(f.c.source, f.store, P04_SCOPE, gB.fetcher, P04_OPTIONS, () => NOW);
    const apiB = new WorkspaceApi(f.repo, undefined, { gmailInbox: serviceB, snapshotForTenant: () => null, principalIdForSession: (p) => p.userId });
    const reqB = (method: "GET" | "POST", path: string, body?: unknown) => apiB.handleAsync({ method, path: "/v1/workspaces/agency/gmail-inbox" + path, authorization: OWNER, body });
    await reqB("POST", "/sync", {});
    assert.deepEqual(((await reqB("GET", "/messages")).body.items as { gmailId: string }[]).map((m) => m.gmailId).sort(), ["b1", "b2"]);
    assert.notEqual(((await reqB("GET", "")).body.context as { tag: string }).tag, tagA);
    assert.equal((await reqB("GET", "/messages?accountRef=" + a.accountRef)).status, 403);
    assert.equal((await reqB("GET", "/messages/" + aItem + "?accountRef=" + a.accountRef)).status, 403);
    assert.equal(((await reqB("GET", "")).body.accounts as unknown[]).length, 2);
    // disconnected: own stored data is readable
    f.c.state.cred = null;
    assert.equal((await reqB("GET", "/messages?accountRef=" + a.accountRef)).status, 200);
    // purge A by its opaque ref, B untouched
    f.c.state.cred = credential({ subject: "account-two", account: "otro@example.test", generation: "e".repeat(64) });
    const prep = await reqB("POST", "/purge/prepare", { accountRef: a.accountRef });
    assert.equal(prep.body.messageCount, 12);
    const purged = await reqB("POST", "/purge", { accountRef: a.accountRef, confirmationId: prep.body.confirmationId, phrase: "BORRAR" });
    assert.equal(purged.status, 200);
    assert.equal(f.store.messageIds(ns).length, 0);
    assert.equal(f.store.messageIds(inboxNamespace("agency", "owner", "account-two")).length, 2);
    await serviceB.close();
  } finally {
    await f.done();
  }
});

test("purge confirmation: phrase, single use, expiry, same count with changed content, foreign account", async () => {
  const f = setup();
  try {
    await f.req("POST", "/sync", {});
    assert.equal((await f.req("POST", "/purge", { confirmationId: "a".repeat(64), phrase: "borrar" })).status, 400);
    // stale: content changes but the count stays the same
    let prep = await f.req("POST", "/purge/prepare", {});
    f.g.setLabels("r05", ["INBOX", "IMPORTANT"]);
    await f.req("POST", "/sync", {});
    assert.equal(f.store.messageIds(ns).length, 12);
    let r = await f.req("POST", "/purge", { confirmationId: prep.body.confirmationId, phrase: "BORRAR" });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, "INBOX_PURGE_CONFIRMATION_STALE");
    // expiry
    prep = await f.req("POST", "/purge/prepare", {});
    f.tick(6 * 60_000);
    assert.equal((await f.req("POST", "/purge", { confirmationId: prep.body.confirmationId, phrase: "BORRAR" })).status, 409);
    // valid once, then reused
    prep = await f.req("POST", "/purge/prepare", {});
    assert.equal((await f.req("POST", "/purge", { confirmationId: prep.body.confirmationId, phrase: "BORRAR" })).status, 200);
    assert.equal((await f.req("POST", "/purge", { confirmationId: prep.body.confirmationId, phrase: "BORRAR" })).status, 409);
    assert.equal(((await f.req("GET", "")).body.state), "paused_after_purge");
    // foreign: a confirmation for account A cannot purge account B
    const refA = ((await f.req("GET", "")).body.account as { accountRef: string }).accountRef;
    const nsB = f.store.ensureNamespace("agency", "owner", "account-two", "otro@example.test");
    const tok = await f.req("POST", "/purge/prepare", { accountRef: refA });
    const foreign = await f.req("POST", "/purge", { accountRef: f.store.namespaceInfo(nsB.ns)!.accountRef, confirmationId: tok.body.confirmationId, phrase: "BORRAR" });
    assert.equal(foreign.status, 409);
    assert.equal(foreign.body.error, "INBOX_PURGE_CONFIRMATION_INVALID");
  } finally {
    await f.done();
  }
});

test("purge waits for the running sync; a session revoked meanwhile fails and data stays", async () => {
  let release!: () => void, block = false;
  const gate = new Promise<void>((r) => (release = r));
  const f = setup();
  const gated = historyGmail(initialMessages(), { onRequest: async (p) => { if (block && p.startsWith("history")) await gate; } });
  const service = new InboxService(f.c.source, f.store, P04_SCOPE, gated.fetcher, P04_OPTIONS, () => NOW);
  const api = new WorkspaceApi(f.repo, undefined, { gmailInbox: service, snapshotForTenant: () => null, principalIdForSession: (p) => p.userId });
  const req = (method: "GET" | "POST", path: string, body?: unknown) => api.handleAsync({ method, path: "/v1/workspaces/agency/gmail-inbox" + path, authorization: OWNER, body });
  try {
    await req("POST", "/sync", {});
    const prep = await req("POST", "/purge/prepare", {});
    block = true;
    const running = req("POST", "/sync", {});
    await new Promise((r) => setTimeout(r, 10));
    assert.equal((await req("POST", "/sync", {})).status, 409); // busy, single flight
    const purge = req("POST", "/purge", { confirmationId: prep.body.confirmationId, phrase: "BORRAR" });
    await new Promise((r) => setTimeout(r, 10));
    f.repo.revokeSession("owner-token-123456");
    release();
    assert.equal((await purge).status, 401);
    await running;
    assert.equal(f.store.messageIds(ns).length, 12);
  } finally {
    await service.close();
    await f.done();
  }
});

test("purge with another process holding the lease is busy and keeps data; works while disconnected", { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "p04-api-")), path = join(dir, "inbox.db");
  const f = setup(path);
  try {
    await f.req("POST", "/sync", {});
    const child = fork(new URL("./fixtures/inbox-p04-lease.ts", import.meta.url), [path], { execArgv: process.execArgv, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    try {
      await once(child, "message");
      const prep = await f.req("POST", "/purge/prepare", {});
      const r = await f.req("POST", "/purge", { confirmationId: prep.body.confirmationId, phrase: "BORRAR" });
      assert.equal(r.status, 409);
      assert.equal(r.body.error, "INBOX_SYNC_ACTIVE");
      assert.equal(f.store.messageIds(ns).length, 12);
    } finally {
      child.kill("SIGKILL");
      await once(child, "exit").catch(() => undefined);
    }
    f.store.releaseLease(ns, "x"); // no-op: a foreign lease is never removed without its token
    f.tick(2 * 60 * 60_000); // the dead holder's lease expires
    f.c.state.cred = null; // disconnected
    const prep = await f.req("POST", "/purge/prepare", {});
    assert.equal((await f.req("POST", "/purge", { confirmationId: prep.body.confirmationId, phrase: "BORRAR" })).status, 200);
    assert.equal(f.store.messageIds(ns).length, 0);
  } finally {
    await f.done();
    rmSync(dir, { recursive: true, force: true });
  }
});
