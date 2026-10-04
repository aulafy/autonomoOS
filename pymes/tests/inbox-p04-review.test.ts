import test from 'node:test';
import assert from 'node:assert/strict';
import { InboxStore, inboxNamespace } from '../src/inbox-store.js';
import { InboxService } from '../src/inbox-service.js';
import { GmailInboxIncremental } from '../src/gmail-inbox-incremental.js';
import { WorkspaceApi, InMemoryWorkspaceRepository } from '../src/workspace-api.js';
import { historyGmail, credentialSource, NOW } from './fixtures/gmail-history-fake.js';
import { initialMessages, P04_SCOPE, P04_OPTIONS } from './fixtures/inbox-p04-scenarios.js';
import { credential } from './fixtures/gmail-inbox-fake.js';
const ns = inboxNamespace('agency', 'owner', 'account-one');
test('single flight is reserved before awaiting a credential', async () => {
    const store = new InboxStore(':memory:', () => NOW), c = credentialSource(), g = historyGmail(initialMessages());
    let release!: () => void;
    const gate = new Promise<void>(r => release = r);
    let waiting = true;
    const source = { credential: async () => { if (waiting)
            await gate; return c.source.credential(); } };
    const service = new InboxService(source, store, P04_SCOPE, g.fetcher, P04_OPTIONS, () => NOW);
    let fullCalls = 0;
    const full = service.sync.fullSync.bind(service.sync);
    service.sync.fullSync = async (s) => { fullCalls++; return full(s); };
    try {
        const first = service.syncNow(), second = service.syncNow();
        waiting = false;
        release();
        const results = await Promise.all([first, second]);
        assert.equal(fullCalls, 1);
        assert.equal(results[1]!.outcome, 'busy');
    }
    finally {
        await service.close();
        store.close();
    }
});
test('closing during credential preflight aborts before any Gmail GET', async () => {
    const store = new InboxStore(':memory:', () => NOW), c = credentialSource(), g = historyGmail(initialMessages());
    let release!: () => void;
    const gate = new Promise<void>(r => release = r);
    const service = new InboxService({ credential: async () => { await gate; return c.source.credential(); } }, store, P04_SCOPE, g.fetcher, P04_OPTIONS, () => NOW);
    try {
        const pending = service.syncNow(), closing = service.close();
        release();
        await Promise.all([pending, closing]);
        assert.equal(g.counts.total, 0);
        assert.equal(store.namespace(ns), null);
    }
    finally {
        await service.close();
        store.close();
    }
});
test('history pagination cycles are rejected across durable checkpoints', async () => {
    const store = new InboxStore(':memory:', () => NOW), c = credentialSource(), g = historyGmail(initialMessages());
    const service = new InboxService(c.source, store, P04_SCOPE, g.fetcher, P04_OPTIONS, () => NOW);
    try {
        await service.syncNow();
        const before = store.namespace(ns)!.historyId;
        const fetcher: typeof fetch = async (i, o) => String(i).includes('/history?') ? new Response(JSON.stringify({ historyId: '800', history: [], nextPageToken: new URL(String(i)).searchParams.get('pageToken') === 'A' ? 'B' : 'A' })) : g.fetcher(i, o);
        const inc = new GmailInboxIncremental(c.source, store, P04_SCOPE, fetcher, { maxRequestsPerRun: 4 }, () => NOW);
        const r = await inc.incremental();
        assert.equal(r.outcome, 'failed');
        assert.equal(store.namespace(ns)!.historyId, before);
    }
    finally {
        await service.close();
        store.close();
    }
});
test('account change while resolving API context does not return the previous message body', async () => {
    const store = new InboxStore(':memory:', () => NOW), c = credentialSource(), g = historyGmail(initialMessages());
    let switchAccount = false;
    const source = { credential: async () => { const old = await c.source.credential(); if (switchAccount) {
            switchAccount = false;
            c.state.cred = credential({ subject: 'account-two', account: 'two@example.test', generation: 'b'.repeat(64) });
        } return old; } };
    const service = new InboxService(source, store, P04_SCOPE, g.fetcher, P04_OPTIONS, () => NOW);
    const repo = new InMemoryWorkspaceRepository();
    const api = new WorkspaceApi(repo, undefined, { gmailInbox: service, snapshotForTenant: () => null, principalIdForSession: p => p.userId });
    api.addSession('review-owner-token-1234', { userId: 'owner', tenantId: 'agency', role: 'owner' });
    try {
        await service.syncNow();
        const id = store.messageIds(ns)[0]!;
        switchAccount = true;
        const response = await api.handleAsync({ method: 'GET', path: '/v1/workspaces/agency/gmail-inbox/messages/' + id, authorization: 'Bearer review-owner-token-1234' });
        assert.equal(response.status, 409);
        assert.equal(response.body.message, undefined);
    }
    finally {
        await service.close();
        store.close();
    }
});
test('HTTP adapter preserves scope, search and limit queries for Gmail inbox', async () => {
    const { handlePymesRequest } = await import('../src/api-server.js');
    const store = new InboxStore(':memory:', () => NOW), c = credentialSource(), g = historyGmail(initialMessages());
    const service = new InboxService(c.source, store, P04_SCOPE, g.fetcher, P04_OPTIONS, () => NOW), repo = new InMemoryWorkspaceRepository();
    const api = new WorkspaceApi(repo, undefined, { gmailInbox: service, snapshotForTenant: () => null, principalIdForSession: p => p.userId });
    api.addSession('review-owner-token-1234', { userId: 'owner', tenantId: 'agency', role: 'owner' });
    try {
        await service.syncNow();
        const response = await handlePymesRequest(api, new Request('http://127.0.0.1/v1/workspaces/agency/gmail-inbox/messages?scope=sent&limit=2', { headers: { Authorization: 'Bearer review-owner-token-1234' } }));
        const value = await response.json() as {
            items: {
                labels: string[];
            }[];
        };
        assert.ok(value.items.length <= 2);
        assert.ok(value.items.every(m => m.labels.includes('SENT')));
    }
    finally {
        await service.close();
        store.close();
    }
});
