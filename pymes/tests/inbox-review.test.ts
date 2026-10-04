import test from 'node:test';
import assert from 'node:assert/strict';
import { GmailInboxSync } from '../src/gmail-inbox-sync.js';
import { InboxStore, inboxNamespace } from '../src/inbox-store.js';
import { fakeGmail, mailbox, credentialSource, credential, NOW } from './fixtures/gmail-inbox-fake.js';
const scope = { tenant: 'review', owner: 'owner' };
const ns = inboxNamespace(scope.tenant, scope.owner, 'account-one');
const options = { selectionCap: 5, maxCandidates: 10, listPageSize: 5, batchSize: 3, maxRequestsPerRun: 20 };
test('malformed successful list response cannot confirm an empty inbox', async () => {
    const store = new InboxStore(':memory:', () => NOW), c = credentialSource(), f = fakeGmail(mailbox(1));
    const fetcher: typeof fetch = async (i, o) => String(i).includes('messages?') ? new Response('{broken', { status: 200 }) : f.fetcher(i, o);
    try {
        const r = await new GmailInboxSync(c.source, store, scope, fetcher, options, () => NOW).fullSync();
        assert.notEqual(r.outcome, 'complete');
        assert.equal(store.namespace(ns)?.historyId, null);
    }
    finally {
        store.close();
    }
});
test('oversized list cannot confirm an empty inbox', async () => {
    const store = new InboxStore(':memory:', () => NOW), c = credentialSource(), f = fakeGmail(mailbox(1));
    const fetcher: typeof fetch = async (i, o) => String(i).includes('messages?') ? new Response(JSON.stringify({ messages: [{ id: 'm0000' }], padding: 'x'.repeat(3000) })) : f.fetcher(i, o);
    try {
        const r = await new GmailInboxSync(c.source, store, scope, fetcher, { ...options, smallResponseMaxBytes: 1000 }, () => NOW).fullSync();
        assert.notEqual(r.outcome, 'complete');
        assert.equal(store.namespace(ns)?.historyId, null);
    }
    finally {
        store.close();
    }
});
test('same subject reconnect during fetch invalidates old generation before writes', async () => {
    const store = new InboxStore(':memory:', () => NOW), c = credentialSource();
    const f = fakeGmail(mailbox(1), { onRequest: (p: string) => { if (p.includes('format=full'))
            c.state.cred = credential({ generation: 'c'.repeat(64) }); } });
    try {
        const r = await new GmailInboxSync(c.source, store, scope, f.fetcher, options, () => NOW).fullSync();
        assert.equal(r.outcome, 'blocked');
        assert.equal(store.messageIds(ns).length, 0);
        assert.equal(store.namespace(ns)?.historyId, null);
    }
    finally {
        store.close();
    }
});
test('a lease for namespace A cannot mutate a run in B', () => {
    const store = new InboxStore(':memory:', () => NOW);
    try {
        const a = store.ensureNamespace('a', 'owner', 'subject', 'a@example.test').ns, b = store.ensureNamespace('b', 'owner', 'subject', 'b@example.test').ns;
        const ta = store.acquireLease(a, 10000)!, tb = store.acquireLease(b, 10000)!, run = store.createRun(b, tb, '1', 0);
        assert.throws(() => store.finishEnumeration(a, ta, run.runId, ['foreign']));
        assert.equal(store.run(run.runId)?.phase, 'enumerate');
    }
    finally {
        store.close();
    }
});
test('NaN budgets and invalid timeouts are rejected at construction', () => {
    const store = new InboxStore(':memory:', () => NOW), c = credentialSource();
    try {
        for (const bad of [{ maxRequestsPerRun: NaN }, { batchSize: Infinity }, { windowMs: -1 }, { leaseTtlMs: 0 }, { requestTimeoutMs: NaN }, { selectionCap: 1.5 }])
            assert.throws(() => new GmailInboxSync(c.source, store, scope, fetch, { ...options, ...bad }, () => NOW));
    }
    finally {
        store.close();
    }
});
test('request budgets smaller than a batch must still make durable progress', async () => {
    const store = new InboxStore(':memory:', () => NOW), c = credentialSource(), f = fakeGmail(mailbox(10));
    try {
        const sync = new GmailInboxSync(c.source, store, scope, f.fetcher, { ...options, batchSize: 25, maxRequestsPerRun: 8 }, () => NOW);
        let r = await sync.fullSync();
        for (let n = 0; n < 5 && r.outcome !== 'complete'; n++)
            r = await sync.fullSync();
        assert.equal(r.outcome, 'complete');
        assert.equal(store.messageIds(ns).length, 5);
    }
    finally {
        store.close();
    }
});
test('repeated pagination token fails without confirming cursor', async () => {
    const store = new InboxStore(':memory:', () => NOW), c = credentialSource(), f = fakeGmail(mailbox(3));
    let n = 0;
    const fetcher: typeof fetch = async (i, o) => String(i).includes('messages?') ? new Response(JSON.stringify({ messages: [{ id: 'unique' + n++ }], nextPageToken: 'same' })) : f.fetcher(i, o);
    try {
        const r = await new GmailInboxSync(c.source, store, scope, fetcher, options, () => NOW).fullSync();
        assert.equal(r.code, 'GMAIL_PAGINATION_INVALID');
        assert.equal(store.namespace(ns)?.historyId, null);
    }
    finally {
        store.close();
    }
});
test('date selection uses full with field projection, never relies on minimal supplying dates', async () => {
    const store = new InboxStore(':memory:', () => NOW), c = credentialSource(), f = fakeGmail(mailbox(10));
    let projected = 0;
    const fetcher: typeof fetch = async (i, o) => { const u = new URL(String(i)); assert.notEqual(u.searchParams.get('format'), 'minimal'); if (u.searchParams.has('fields')) {
        assert.equal(u.searchParams.get('format'), 'full');
        assert.equal(u.searchParams.get('fields'), 'id,labelIds,internalDate');
        projected++;
    } return f.fetcher(i, o); };
    try {
        const r = await new GmailInboxSync(c.source, store, scope, fetcher, options, () => NOW).fullSync();
        assert.equal(r.outcome, 'complete');
        assert.equal(projected, 10);
        assert.equal(store.messageIds(ns).length, 5);
    }
    finally {
        store.close();
    }
});
test('oversized bodies plus a small budget still resume and finish without losing stored messages', async () => {
    const store = new InboxStore(':memory:', () => NOW), c = credentialSource(), msgs = mailbox(5);
    msgs.forEach(m => m.bigBytes = 3000);
    const f = fakeGmail(msgs);
    try {
        const sync = new GmailInboxSync(c.source, store, scope, f.fetcher, { ...options, batchSize: 25, maxRequestsPerRun: 8, fullResponseMaxBytes: 1500 }, () => NOW);
        let r = await sync.fullSync();
        for (let n = 0; n < 6 && r.outcome !== 'complete'; n++)
            r = await sync.fullSync();
        assert.equal(r.outcome, 'complete');
        assert.equal(store.messageIds(ns).length, 5);
        assert.equal(store.message(ns, 'm0000')?.quality?.bodyUnavailable, true);
    }
    finally {
        store.close();
    }
});
for (const invalid of ['date', 'labels', 'id'])
    test('invalid ' + invalid + ' in selected message cannot become an omitted or empty successful message', async () => {
        const store = new InboxStore(':memory:', () => NOW), c = credentialSource(), f = fakeGmail(mailbox(1));
        const fetcher: typeof fetch = async (i, o) => { const r = await f.fetcher(i, o); if (String(i).includes('format=full')) {
            const v = await r.json() as Record<string, unknown>;
            if (invalid === 'date')
                v.internalDate = null;
            if (invalid === 'labels')
                v.labelIds = 'INBOX';
            if (invalid === 'id')
                v.id = 'other';
            return new Response(JSON.stringify(v));
        } return r; };
        try {
            const r = await new GmailInboxSync(c.source, store, scope, fetcher, options, () => NOW).fullSync();
            assert.equal(r.outcome, 'failed');
            assert.equal(store.namespace(ns)?.historyId, null);
            assert.equal(store.messageIds(ns).length, 0);
        }
        finally {
            store.close();
        }
    });
test('parser quality and attachment-backed omitted body survive reopening; schema 1 upgrades without fabricating quality', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { DatabaseSync } = await import('node:sqlite');
    const dir = mkdtempSync(join(tmpdir(), 'inbox-review-')), path = join(dir, 'inbox.db');
    let store = new InboxStore(path, () => NOW);
    const c = credentialSource(), f = fakeGmail(mailbox(1));
    const fetcher: typeof fetch = async (i, o) => { const r = await f.fetcher(i, o); if (String(i).includes('format=full')) {
        const v = await r.json() as any;
        v.payload = { mimeType: 'text/plain', body: { attachmentId: 'not-downloaded', size: 3 }, headers: [{ name: 'Subject', value: 'Omitted body' }] };
        return new Response(JSON.stringify(v));
    } return r; };
    try {
        assert.equal((await new GmailInboxSync(c.source, store, scope, fetcher, options, () => NOW).fullSync()).outcome, 'complete');
        store.close();
        store = new InboxStore(path, () => NOW);
        assert.equal(store.message(ns, 'm0000')?.quality?.bodyUnavailable, true);
        assert.equal(store.message(ns, 'm0000')?.bodyText, '');
        store.close();
        const d = new DatabaseSync(path);
        d.exec('ALTER TABLE inbox_message DROP COLUMN quality_json');
        d.prepare("UPDATE inbox_meta SET value='1' WHERE key='schema_version'").run();
        d.close();
        store = new InboxStore(path, () => NOW);
        assert.equal(store.message(ns, 'm0000')?.quality, null);
        assert.equal(store.messageIds(ns).length, 1);
    }
    finally {
        store.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
test('HTML with many unclosed tags is processed with bounded work and stays inert', async () => {
    const { htmlToText } = await import('../src/inbox-mime.js');
    const start = performance.now();
    assert.equal(htmlToText('<'.repeat(100000) + '>').length, 99999);
    assert.equal(htmlToText('<script>'.repeat(20000)), '');
    assert.ok(performance.now() - start < 2000);
});
test('independent HTTP server exercises real fetch, pagination and durable restart with synthetic mail', async () => {
    const { createServer } = await import('node:http');
    const { once } = await import('node:events');
    const { mkdtempSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'inbox-http-')), path = join(dir, 'inbox.db'), f = fakeGmail(mailbox(7));
    let store = new InboxStore(path, () => NOW);
    const c = credentialSource();
    const server = createServer(async (req, res) => { try {
        assert.equal(req.method, 'GET');
        const r = await f.fetcher('https://gmail.googleapis.com' + req.url, { method: 'GET' });
        res.writeHead(r.status, { 'content-type': 'application/json' });
        res.end(await r.text());
    }
    catch {
        res.writeHead(500);
        res.end('{}');
    } });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as {
        port: number;
    }).port;
    const transport: typeof fetch = (i, o) => { const u = new URL(String(i)); return fetch('http://127.0.0.1:' + port + u.pathname + u.search, o); };
    try {
        assert.equal((await new GmailInboxSync(c.source, store, scope, transport, options, () => NOW).fullSync()).outcome, 'complete');
        store.close();
        store = new InboxStore(path, () => NOW);
        assert.equal(store.messageIds(ns).length, 5);
        assert.equal(store.namespace(ns)?.historyId, '1000');
        assert.deepEqual([...f.methods], ['GET']);
    }
    finally {
        store.close();
        await new Promise<void>(resolve => server.close(() => resolve()));
        rmSync(dir, { recursive: true, force: true });
    }
});
test('an empty object without evidence of an empty listing cannot advance H0', async () => {
    const store = new InboxStore(':memory:', () => NOW), c = credentialSource(), f = fakeGmail(mailbox(1));
    const transport: typeof fetch = async (i, o) => String(i).includes('messages?') ? new Response('{}') : f.fetcher(i, o);
    try {
        const r = await new GmailInboxSync(c.source, store, scope, transport, options, () => NOW).fullSync();
        assert.equal(r.code, 'GMAIL_LIST_INVALID');
        assert.equal(store.namespace(ns)?.historyId, null);
    }
    finally {
        store.close();
    }
});
test('namespace ownership applies to dates, selection, publication, abandonment and completion', () => {
    const store = new InboxStore(':memory:', () => NOW);
    try {
        const a = store.ensureNamespace('a', 'o', 's', 'a@example.test').ns, b = store.ensureNamespace('b', 'o', 's', 'b@example.test').ns, ta = store.acquireLease(a, 10000)!, tb = store.acquireLease(b, 10000)!, run = store.createRun(b, tb, '42', 0);
        store.finishEnumeration(b, tb, run.runId, ['one']);
        assert.throws(() => store.recordCandidateDate(a, ta, run.runId, 'one', NOW, null));
        assert.throws(() => store.select(a, ta, run.runId, 1));
        assert.throws(() => store.abandonRun(a, ta, run.runId));
        store.select(b, tb, run.runId, 1);
        assert.throws(() => store.writeBatch(a, ta, run.runId, [], [{ gmailId: 'one', outcome: 'gone' }]));
        assert.throws(() => store.completeRun(a, ta, run.runId));
        assert.equal(store.run(run.runId)?.phase, 'fetch');
        assert.equal(store.namespace(a)?.historyId, null);
    }
    finally {
        store.close();
    }
});

test('a multipart attachment never contributes its children to the message body',async()=>{
 const {parseGmailPayload}=await import('../src/inbox-mime.js');const p=parseGmailPayload({mimeType:'multipart/mixed',parts:[{mimeType:'multipart/alternative',filename:'attached.mime',headers:[{name:'Content-Disposition',value:'attachment'}],parts:[{mimeType:'text/plain',body:{data:Buffer.from('attachment content must stay out').toString('base64url')}}]}]});assert.equal(p.bodyText,'');assert.equal(p.attachments.length,1);assert.equal(p.attachments[0]?.filename,'attached.mime');
});
