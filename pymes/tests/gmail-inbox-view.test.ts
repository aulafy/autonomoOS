import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceApi, InMemoryWorkspaceRepository } from '../src/workspace-api.js';
import { handlePymesRequest } from '../src/api-server.js';
import { WorkspaceClient } from '../src/workspace-client.js';
import { InboxStore } from '../src/inbox-store.js';
import { InboxService } from '../src/inbox-service.js';
import { acceptInboxDetail, reconcileInboxSelection, parseGmailInboxPage, parseGmailInboxDetail, parseGmailInboxStatus, parsePurgeChallenge } from '../src/gmail-inbox-view.js';
import { historyGmail, msg, credentialSource, NOW } from './fixtures/gmail-history-fake.js';
import { credential } from './fixtures/gmail-inbox-fake.js';
import { P04_SCOPE, P04_OPTIONS } from './fixtures/inbox-p04-scenarios.js';
async function fixture() {
    const c = credentialSource(), g = historyGmail(Array.from({ length: 35 }, (_, i) => msg('mail' + i, { subject: 'Oferta ' + i, labels: [i % 2 ? 'SENT' : 'INBOX'] })));
    const store = new InboxStore(':memory:', () => NOW), service = new InboxService(c.source, store, P04_SCOPE, g.fetcher, P04_OPTIONS, () => NOW);
    const repo = new InMemoryWorkspaceRepository(), api = new WorkspaceApi(repo, undefined, { gmailInbox: service, snapshotForTenant: () => null, principalIdForSession: p => p.userId });
    api.addSession('view-owner-token-123456', { userId: 'owner', tenantId: 'agency', role: 'owner' });
    const transport: typeof fetch = (input, init) => handlePymesRequest(api, new Request(String(input), init));
    const client = new WorkspaceClient({ baseUrl: 'http://127.0.0.1', tenantId: 'agency', token: 'view-owner-token-123456' }, transport);
    await service.syncNow();
    return { c, g, store, service, client, done: async () => { await service.close(); store.close(); } };
}
test('client → HTTP → API → store preserves Gmail scope, search, detail and tenant', async () => {
    const f = await fixture();
    try {
        const status = await f.client.gmailInbox();
        assert.equal(status.messageCount, 35);
        const page = await f.client.gmailInboxMessages({ scope: 'sent', query: 'Oferta 1', accountRef: status.account!.accountRef });
        assert.equal(page.items.length, 6);
        assert.ok(page.items.every(m => m.labels.includes('SENT') && m.subject!.includes('Oferta 1')));
        assert.ok(page.items.some(m => m.gmailId === 'mail1'));
        const detail = await f.client.gmailInboxMessage('mail1', status.account!.accountRef);
        assert.equal(detail.message.bodyText, 'Cuerpo mail1');
        assert.equal(acceptInboxDetail(page.context, detail, page.items, 'mail1'), true);
        assert.equal(reconcileInboxSelection(page.items, 'mail2', true), null);
        assert.equal(acceptInboxDetail(page.context, detail, page.items, 'mail2'), false);
    }
    finally {
        await f.done();
    }
});
test('client paginates without overlaps and cannot reuse a cursor with another filter', async () => {
    const f = await fixture();
    try {
        f.g.messages.forEach(m => f.g.setLabels(m.id, ['INBOX']));
        while ((await f.service.syncNow()).outcome !== 'complete') { }
        const first = await f.client.gmailInboxMessages({ scope: 'inbox', query: '' });
        assert.equal(first.items.length, 30);
        assert.ok(first.nextCursor);
        const second = await f.client.gmailInboxMessages({ scope: 'inbox', query: '', cursor: first.nextCursor });
        assert.equal(second.items.length, 5);
        assert.equal(new Set([...first.items, ...second.items].map(m => m.gmailId)).size, 35);
        await assert.rejects(f.client.gmailInboxMessages({ scope: 'sent', query: '', cursor: first.nextCursor }), /INBOX_CURSOR_INVALID/);
    }
    finally {
        await f.done();
    }
});
test('late detail responses are rejected after account, credential, revision, selection or authorization changes', async () => {
    const f = await fixture();
    try {
        const page = await f.client.gmailInboxMessages({ scope: 'inbox', query: '' }), id = page.items[0]!.gmailId;
        const detail = await f.client.gmailInboxMessage(id, page.context.accountRef!);
        for (const context of [{ ...page.context, tag: 'f'.repeat(24) }, { ...page.context, accountRef: 'f'.repeat(32) }, { ...page.context, revision: page.context.revision + 1 }, null])
            assert.equal(acceptInboxDetail(context, detail, page.items, id), false);
        assert.equal(acceptInboxDetail(page.context, detail, [], id), false);
        assert.equal(reconcileInboxSelection(page.items, id, false), null);
    }
    finally {
        await f.done();
    }
});
test('Gmail response validation rejects foreign tenants, inconsistent accounts and duplicate list rows', async () => {
    const f = await fixture();
    try {
        const status = await f.client.gmailInbox(), page = await f.client.gmailInboxMessages({ scope: 'inbox', query: '' });
        assert.throws(() => parseGmailInboxStatus({ ...status, tenantId: 'foreign' }, 'agency'));
        assert.throws(() => parseGmailInboxStatus({ ...status, tenantId: 'agency', context: { ...status.context, accountRef: 'f'.repeat(32) } }, 'agency'));
        assert.throws(() => parseGmailInboxPage({ ...page, tenantId: 'agency', items: [page.items[0], page.items[0]] }, 'agency'));
        assert.throws(() => parseGmailInboxPage({ ...page, tenantId: 'foreign' }, 'agency'));
        assert.throws(() => parseGmailInboxPage({ ...page, tenantId: 'agency', nextCursor: 'x'.repeat(513) }, 'agency'));
    }
    finally {
        await f.done();
    }
});
test('body and attachment limits are enforced while email text remains plain data', async () => {
    const f = await fixture();
    try {
        const status = await f.client.gmailInbox(), value = await f.client.gmailInboxMessage('mail0', status.account!.accountRef), raw = { ...value, tenantId: 'agency' };
        const hostile = '<img src="https://example.invalid/pixel" onerror="alert(1)">';
        assert.equal(parseGmailInboxDetail({ ...raw, message: { ...value.message, bodyText: hostile } }, 'agency').message.bodyText, hostile);
        assert.throws(() => parseGmailInboxDetail({ ...raw, message: { ...value.message, bodyText: 'x'.repeat(65537) } }, 'agency'));
        assert.throws(() => parseGmailInboxDetail({ ...raw, message: { ...value.message, scopeState: 'deleted' } }, 'agency'));
        assert.throws(() => parseGmailInboxDetail({ ...raw, message: { ...value.message, attachments: Array(101).fill({ partId: '1', filename: 'x', mimeType: 'text/plain', size: 0 }) } }, 'agency'));
    }
    finally {
        await f.done();
    }
});
test('purge is explicit through client and HTTP, keeps Gmail untouched and pauses automatic import', async () => {
    const f = await fixture();
    try {
        const status = await f.client.gmailInbox(), challenge = await f.client.gmailInboxPreparePurge(status.account!.accountRef);
        assert.throws(() => parsePurgeChallenge({ ...challenge, tenantId: 'foreign' }, 'agency'));
        await assert.rejects(f.client.gmailInboxPurge(challenge, 'borrar'), /GMAIL_INBOX_PURGE_PHRASE_REQUIRED/);
        assert.equal((await f.client.gmailInbox()).messageCount, 35);
        const result = await f.client.gmailInboxPurge(challenge, 'BORRAR');
        assert.equal(result.state, 'paused_after_purge');
        assert.equal(result.messageCount, 0);
        await assert.rejects(f.client.gmailInboxPurge(challenge, 'BORRAR'));
        const count = f.g.counts.total;
        await f.service.tick();
        assert.equal(f.g.counts.total, count);
        assert.equal(f.g.messages.length, 35);
        await f.service.syncNow();
        assert.equal((await f.client.gmailInbox()).messageCount, 35);
    }
    finally {
        await f.done();
    }
});
test('background synchronization acknowledges before Gmail responds and later publishes the result', async () => {
    const f = await fixture();
    let release!: () => void;
    const gate = new Promise<void>(r => release = r);
    try {
        const full = f.service.incremental.incremental.bind(f.service.incremental);
        f.service.incremental.incremental = async (s) => { await gate; return full(s); };
        const ack = await f.client.gmailInboxSync();
        assert.equal(ack.running, true);
        release();
        await f.service.cancel();
        assert.equal(f.service.isRunning, false);
    }
    finally {
        release?.();
        await f.done();
    }
});
test('missing readonly authorization is visible before the first import and issues no Gmail request', async () => {
    const c = credentialSource();
    c.state.cred = credential({ scopes: [] });
    const g = historyGmail([]), store = new InboxStore(':memory:', () => NOW), service = new InboxService(c.source, store, P04_SCOPE, g.fetcher, P04_OPTIONS, () => NOW);
    try {
        const status = service.status(await service.context(null));
        assert.equal(status.state, 'needs_reconnect');
        assert.equal(status.errorCode, 'GMAIL_READ_SCOPE_MISSING');
        assert.equal((await service.syncNow()).outcome, 'blocked');
        assert.equal(g.counts.total, 0);
    }
    finally {
        await service.close();
        store.close();
    }
});
