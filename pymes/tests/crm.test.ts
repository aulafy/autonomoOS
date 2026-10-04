import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { openWorkspaceRuntime } from '../src/runtime-source.js';
import { WorkspaceApi, InMemoryWorkspaceRepository } from '../src/workspace-api.js';
import { handlePymesRequest } from '../src/api-server.js';
import { WorkspaceClient } from '../src/workspace-client.js';
import { CrmStore } from '../src/crm-store.js';
import { crmMailbox } from '../src/crm-service.js';
import { parseCrmView } from '../src/crm-view.js';
import { normalizeCrmEmail, parseCrmCommand, type CrmOperation } from '../src/crm-contract.js';
import { InboxService } from '../src/inbox-service.js';
import { InboxStore } from '../src/inbox-store.js';
import { historyGmail, msg, credentialSource, NOW } from './fixtures/gmail-history-fake.js';
import { P04_OPTIONS, P04_SCOPE } from './fixtures/inbox-p04-scenarios.js';
import { credential } from './fixtures/gmail-inbox-fake.js';
import { FakeEmailProvider } from '../src/email-provider.js';
import type { InferenceProvider, ProposedPlan } from '@agent-world/inference';
const contact = (id = 'client-1', email = 'cliente@example.test'): CrmOperation => ({ type: 'contact.create', id, name: 'Cliente sintético', email, phone: '', notes: '', relationship: 'prospect' });
const apply = (s: CrmStore, op: CrmOperation, id: string, owner = 'owner', revision = s.revision(owner)) => s.apply({ tenant: 'agency', owner, commandId: id, expectedRevision: revision, operation: op, at: NOW, source: { kind: 'user' } });
async function fixture(fetchOverride?: (base: typeof fetch) => typeof fetch) {
    const dir = mkdtempSync(join(tmpdir(), 'crm-p05-')), c = credentialSource(), g = historyGmail([msg('in1')]), inboxStore = new InboxStore(':memory:', () => NOW);
    const inbox = new InboxService(c.source, inboxStore, P04_SCOPE, fetchOverride ? fetchOverride(g.fetcher) : g.fetcher, P04_OPTIONS, () => NOW);
    await inbox.syncNow();
    const runtime = await openWorkspaceRuntime(join(dir, 'runtime.db'), 'agency', { gmailInbox: inbox }), repo = new InMemoryWorkspaceRepository(), api = new WorkspaceApi(repo, undefined, runtime.source);
    for (const [user, role] of [['owner', 'owner'], ['other', 'owner'], ['agent', 'agent']] as const)
        api.addSession(user + '-token-123456789', { userId: user, tenantId: 'agency', role });
    const client = new WorkspaceClient({ baseUrl: 'http://127.0.0.1', tenantId: 'agency', token: 'owner-token-123456789' }, (i, o) => handlePymesRequest(api, new Request(String(i), o)));
    const command = async (op: CrmOperation, id: string) => client.crmCommand({ commandId: id, expectedRevision: (await client.crm()).revision, operation: op });
    const accountRef = (await inbox.context(null)).info!.accountRef;
    return { dir, c, g, inbox, inboxStore, runtime, repo, api, client, command, accountRef, done: async () => { await inbox.close(); inboxStore.close(); runtime.close(); rmSync(dir, { recursive: true, force: true }); } };
}
test('CRM commands are isolated, atomic on validation failure, idempotent and revision guarded', () => {
    const s = new CrmStore('agency'), created = apply(s, contact(), 'c1');
    assert.equal(created.revision, 1);
    assert.deepEqual(apply(s, contact(), 'c1', 'owner', 0), created);
    assert.throws(() => apply(s, { ...contact(), name: 'Otro' } as CrmOperation, 'c1'), /CRM_COMMAND_CONFLICT/);
    assert.throws(() => apply(s, contact('client-2'), 'c2', 'owner', 0), /CRM_REVISION_CONFLICT/);
    assert.throws(() => apply(s, { type: 'followup.create', id: 'f', contactId: 'client-1', leadId: 'missing', title: 'Llamar', dueAt: NOW }, 'f1'), /CRM_LEAD_NOT_FOUND/);
    assert.equal(s.revision('owner'), 1);
    assert.equal(s.view('owner').followUps.length, 0);
    assert.equal(s.view('other').contacts.length, 0);
    apply(s, contact(), 'other-c1', 'other');
    assert.equal(s.view('other').contacts.length, 1);
    assert.throws(() => s.apply({ tenant: 'foreign', owner: 'owner', commandId: 'x', expectedRevision: 1, operation: contact(), at: NOW, source: { kind: 'user' } }), /CRM_SCOPE_DENIED/);
});
test('email normalization does not merge dots or plus aliases and matching never verifies identity', () => {
    const s = new CrmStore('agency');
    apply(s, contact('a', 'CLIENTE@EXAMPLE.TEST '), 'a');
    assert.equal(s.match('owner', 'cliente@example.test').length, 1);
    assert.equal(s.view('owner', { contactId: 'a' }).identities[0]!.verified, false);
    assert.notEqual(normalizeCrmEmail('a.b@gmail.com'), normalizeCrmEmail('ab@gmail.com'));
    assert.notEqual(normalizeCrmEmail('a+tag@gmail.com'), normalizeCrmEmail('a@gmail.com'));
    apply(s, contact('b'), 'b');
    assert.equal(s.match('owner', 'cliente@example.test').length, 2);
    apply(s, { type: 'contact.update', id: 'b', name: 'B', phone: '', notes: '', relationship: 'client', status: 'archived' }, 'archive');
    assert.equal(s.match('owner', 'cliente@example.test').length, 1);
    for (const value of ['A <a@example.test>, B <b@example.test>', 'a@example.test; b@example.test', 'a@example.test\r\nBcc: evil@example.test', 'Grupo: a@example.test;'])
        assert.equal(crmMailbox(value), null);
    assert.equal(crmMailbox('Nombre <CLIENTE@example.test>'), 'cliente@example.test');
});
test('API authorization denies absent session, wrong role, wrong tenant and forged identity fields', async () => {
    const f = await fixture();
    try {
        for (const [auth, path, status] of [['', '/v1/workspaces/agency/crm', 401], ['Bearer agent-token-123456789', '/v1/workspaces/agency/crm', 403], ['Bearer owner-token-123456789', '/v1/workspaces/foreign/crm', 403]] as const)
            assert.equal((await f.api.handleAsync({ method: 'GET', path, authorization: auth })).status, status);
        const r = await f.api.handleAsync({ method: 'POST', path: '/v1/workspaces/agency/crm/commands', authorization: 'Bearer owner-token-123456789', body: { commandId: 'x', expectedRevision: 0, owner: 'other', operation: contact() } });
        assert.equal(r.status, 400);
        await f.command(contact(), 'c1');
        const other = await f.api.handleAsync({ method: 'GET', path: '/v1/workspaces/agency/crm', authorization: 'Bearer other-token-123456789' });
        assert.deepEqual(other.body.contacts, []);
    }
    finally {
        await f.done();
    }
});
test('client → HTTP → journal supports contact, identity, lead, note and follow-up lifecycle', async () => {
    const f = await fixture();
    try {
        await f.command(contact(), 'c1');
        await f.command({ type: 'identity.add', id: 'id2', contactId: 'client-1', email: 'other@example.test' }, 'i2');
        await f.command({ type: 'lead.create', id: 'lead', contactId: 'client-1', title: 'Seguro de responsabilidad civil', line: 'professional_liability' }, 'l1');
        await f.command({ type: 'lead.update', id: 'lead', status: 'proposal' }, 'l2');
        await f.command({ type: 'interaction.note', id: 'note', contactId: 'client-1', summary: 'Pedir documentación antes de llamar' }, 'n1');
        await f.command({ type: 'followup.create', id: 'follow', contactId: 'client-1', leadId: 'lead', title: 'Llamada de revisión', dueAt: Date.now() - 1000 }, 'f1');
        const view = await f.client.crm({ contactId: 'client-1', taskStatus: 'all' });
        assert.equal(view.leads[0]!.status, 'proposal');
        assert.equal(view.identities.length, 2);
        assert.equal(view.interactions[0]!.state, 'note');
        assert.equal(view.counts.overdue, 1);
        await f.command({ type: 'followup.update', id: 'follow', status: 'done' }, 'f2');
        assert.equal((await f.client.crm()).followUpsTotal, 0);
        assert.equal((await f.client.crm({ query: 'OTHER@EXAMPLE.TEST' })).contacts.length, 1);
        await f.command({ type: 'identity.remove', id: 'id2' }, 'i3');
        assert.equal((await f.client.crm({ query: 'other@example.test' })).contacts.length, 0);
    }
    finally {
        await f.done();
    }
});
test('new sender creates no contact; unique exact match auto-links once and unlink stays undone', async () => {
    const f = await fixture();
    try {
        const first = await f.client.crmResolve(f.accountRef, 'in1');
        assert.equal(first.reason, 'new_sender');
        assert.equal((await f.client.crm()).contacts.length, 0);
        await f.command(contact(), 'c1');
        const r = await f.client.crmResolve(f.accountRef, 'in1');
        assert.equal(r.reason, 'exact_unique');
        assert.equal(r.link!.contactId, 'client-1');
        assert.equal(r.link!.automatic, true);
        const v = await f.client.crm({ contactId: 'client-1' });
        assert.equal(v.interactions.length, 1);
        assert.equal(v.interactions[0]!.state, 'received');
        assert.equal(v.interactions[0]!.source.kind, 'gmail');
        await f.client.crmResolve(f.accountRef, 'in1');
        assert.equal((await f.client.crm()).revision, v.revision);
        await f.command({ type: 'mail.unlink', accountRef: f.accountRef, gmailId: 'in1' }, 'unlink');
        assert.equal((await f.client.crmResolve(f.accountRef, 'in1')).link!.contactId, null);
        assert.equal((await f.client.crm({ contactId: 'client-1' })).interactions.length, 1);
    }
    finally {
        await f.done();
    }
});
test('ambiguous or differing Reply-To requires human review before linking', async () => {
    const f = await fixture(base => async (i, o) => {
        const response = await base(i, o);
        if (!new URL(String(i)).pathname.endsWith('/messages/in1') || new URL(String(i)).searchParams.has('fields'))
            return response;
        const v = await response.json() as {
            payload?: {
                headers: {
                    name: string;
                    value: string;
                }[];
            };
        };
        v.payload?.headers.push({ name: 'Reply-To', value: 'other@example.test' });
        return new Response(JSON.stringify(v));
    });
    try {
        await f.command(contact(), 'a');
        const r = await f.client.crmResolve(f.accountRef, 'in1');
        assert.equal(r.reason, 'reply_to_mismatch');
        assert.equal(r.link, null);
        await assert.rejects(f.client.crmLink({ commandId: 'no', expectedRevision: r.revision, accountRef: f.accountRef, gmailId: 'in1', contactId: null, reviewed: false }), /CRM_HUMAN_REVIEW_REQUIRED/);
        await assert.rejects(f.client.crmLink({ commandId: 'no2', expectedRevision: r.revision, accountRef: f.accountRef, gmailId: 'in1', contactId: 'client-1', reviewed: false }), /CRM_HUMAN_REVIEW_REQUIRED/);
        await f.client.crmLink({ commandId: 'yes', expectedRevision: r.revision, accountRef: f.accountRef, gmailId: 'in1', contactId: 'client-1', reviewed: true });
        assert.equal((await f.client.crmResolve(f.accountRef, 'in1')).link!.automatic, false);
    }
    finally {
        await f.done();
    }
    const a = await fixture();
    try {
        await a.command(contact('a'), 'a');
        await a.command(contact('b'), 'b');
        const r = await a.client.crmResolve(a.accountRef, 'in1');
        assert.equal(r.reason, 'ambiguous');
        assert.equal(r.link, null);
    }
    finally {
        await a.done();
    }
});
test('mail resolution checks live session and current account after awaits', async () => {
    const f = await fixture();
    try {
        await f.command(contact(), 'c1');
        f.c.state.cred = credential({ subject: 'different', account: 'other@example.test', generation: 'e'.repeat(64) });
        await assert.rejects(f.client.crmResolve(f.accountRef, 'in1'), /CRM_MAIL_NOT_AVAILABLE/);
        f.c.state.cred = credential();
        let n = 0;
        const old = f.inbox.context.bind(f.inbox);
        f.inbox.context = async (ref) => {
            const ctx = await old(ref);
            if (++n === 2)
                f.repo.revokeSession('owner-token-123456789');
            return ctx;
        };
        await assert.rejects(f.client.crmResolve(f.accountRef, 'in1'), /UNAUTHENTICATED/);
        assert.equal(f.runtime.source.crm!.store.view('owner', { contactId: 'client-1' }).interactions.length, 0);
    }
    finally {
        await f.done();
    }
});
test('unknown governed effect is an uncertain interaction; commitment adds one follow-up; replay is exact', async () => {
    const f = await fixture();
    try {
        await f.command(contact(), 'c1');
        const adapter = f.runtime.source.crm!.workflowAdapter();
        adapter.prepare('task', 'owner', { contactId: 'client-1', to: ['cliente@example.test'] }, 'Consulta');
        adapter.effect('task', 'owner', { id: 'effect', effective: 'unknown' });
        let v = await f.client.crm({ contactId: 'client-1', taskStatus: 'all' });
        assert.equal(v.interactions[0]!.state, 'unknown');
        assert.equal(v.followUps.length, 0);
        adapter.effect('task', 'owner', { id: 'effect', effective: 'committed' });
        adapter.effect('task', 'owner', { id: 'effect', effective: 'committed' });
        v = await f.client.crm({ contactId: 'client-1', taskStatus: 'all' });
        assert.equal(v.interactions.length, 1);
        assert.equal(v.interactions[0]!.state, 'committed');
        assert.equal(v.followUps.length, 1);
        adapter.effect('task', 'owner', { id: 'effect', effective: 'unknown' });
        assert.equal((await f.client.crm({ contactId: 'client-1' })).interactions[0]!.state, 'committed');
        assert.throws(() => adapter.effect('task', 'owner', { id: 'effect', effective: 'failed' }), /CRM_EFFECT_STATE_REGRESSION/);
        f.runtime.close();
        const reopened = await openWorkspaceRuntime(join(f.dir, 'runtime.db'), 'agency');
        assert.deepEqual(reopened.source.crm!.store.view('owner', { contactId: 'client-1', taskStatus: 'all' }, NOW), f.runtime.source.crm!.store.view('owner', { contactId: 'client-1', taskStatus: 'all' }, NOW));
        reopened.close();
    }
    finally {
        await f.done();
    }
});
test('journal survives SIGKILL after CRM commit and restores identical command idempotency', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crm-crash-'));
    try {
        const child = fork(new URL('./fixtures/crm-crash.ts', import.meta.url), [join(dir, 'runtime.db')], { execArgv: ['--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
        let errors = '';
        child.stderr?.on('data', d => errors += d);
        const [message] = await once(child, 'message');
        assert.equal(message, 'committed', errors);
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
        const runtime = await openWorkspaceRuntime(join(dir, 'runtime.db'), 'agency');
        try {
            assert.equal(runtime.source.crm!.store.view('owner').contacts.length, 1);
            const result = runtime.source.crm!.command('agency', 'owner', { commandId: 'create-once', expectedRevision: 0, operation: contact() });
            assert.equal(result.revision, 1);
            assert.equal(runtime.source.crm!.store.view('owner').contacts.length, 1);
        }
        finally {
            runtime.close();
        }
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('CRM response validation fails on foreign tenant, mismatched selection and oversized or injected ids', async () => {
    const f = await fixture();
    try {
        await f.command(contact(), 'c1');
        const view = await f.client.crm({ contactId: 'client-1' });
        assert.throws(() => parseCrmView({ ...view, tenantId: 'foreign' }, 'agency', 'client-1'));
        assert.throws(() => parseCrmView({ ...view, tenantId: 'agency' }, 'agency', 'other'));
        assert.throws(() => parseCrmCommand({ commandId: 'bad', expectedRevision: 0, operation: { ...contact(), id: '__proto__' } }));
        assert.throws(() => parseCrmView({ ...view, tenantId: 'agency', contacts: Array(201).fill(view.contacts[0]) }, 'agency', 'client-1'));
    }
    finally {
        await f.done();
    }
});
const provider: InferenceProvider = { id: 'fixture', capabilities: async () => ['structured_output'], health: async () => ({ ok: true, provider: 'fixture', endpoint: 'http://127.0.0.1', authConfigured: false }), proposePlan: async (c) => ({ plan: { actions: c.availableActions.map(action => ({ action, targetId: c.entities.find(e => e.affordances.includes(action))!.id, parameters: {} })) } as ProposedPlan, rawText: '', latencyMs: 0 }) };
test('email workflow writes real CRM projections without bypassing exact approval or C11', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crm-workflow-')), mail = new FakeEmailProvider(join(dir, 'mail.db')), runtime = await openWorkspaceRuntime(join(dir, 'runtime.db'), 'agency', { provider, emailProvider: mail });
    try {
        runtime.source.crm!.command('agency', 'owner', { commandId: 'c1', expectedRevision: 0, operation: contact('simulated-contact', 'client@example.test') });
        runtime.source.createTask!('agency', 'owner', { id: 'job', goal: 'Consulta de seguro' });
        await runtime.source.planTask!('agency', 'owner', { taskId: 'job', workflow: 'email-lead-v1' });
        const email = runtime.source.email!, r = await email.propose('job', 'owner');
        assert.equal(mail.counts().sent, 0);
        assert.equal(runtime.source.crm!.store.view('owner', { contactId: 'simulated-contact' }).leads.length, 1);
        await assert.rejects(email.execute('job', 'owner'), /EMAIL_APPROVAL_REQUIRED/);
        await email.decide('job', 'owner', { bindingHash: r.review!.bindingHash, decision: 'approved' });
        await email.execute('job', 'owner');
        await email.execute('job', 'owner');
        const view = runtime.source.crm!.store.view('owner', { contactId: 'simulated-contact', taskStatus: 'all' });
        assert.equal(view.interactions[0]!.state, 'committed');
        assert.equal(view.followUps.length, 1);
        assert.equal(mail.counts().sent, 1);
    }
    finally {
        runtime.close();
        mail.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
test('duplicate address headers never trigger automatic contact linking', async () => {
    const f = await fixture(base => async (i, o) => {
        const response = await base(i, o);
        if (!new URL(String(i)).pathname.endsWith('/messages/in1') || new URL(String(i)).searchParams.has('fields'))
            return response;
        const value = await response.json() as {
            payload?: {
                headers: {
                    name: string;
                    value: string;
                }[];
            };
        };
        value.payload?.headers.push({ name: 'From', value: 'unknown@example.test' });
        return new Response(JSON.stringify(value));
    });
    try {
        await f.command(contact(), 'c1');
        const r = await f.client.crmResolve(f.accountRef, 'in1');
        assert.equal(r.reason, 'header_review_required');
        assert.equal(r.link, null);
    }
    finally {
        await f.done();
    }
});
test('UNKNOWN survives restart in the real governed workflow and reconciliation never resends', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crm-unknown-')), mail = new FakeEmailProvider(join(dir, 'mail.db'), { hideObservation: true });
    let runtime = await openWorkspaceRuntime(join(dir, 'runtime.db'), 'agency', { provider, emailProvider: mail });
    try {
        runtime.source.crm!.command('agency', 'owner', { commandId: 'c1', expectedRevision: 0, operation: contact('simulated-contact', 'client@example.test') });
        runtime.source.createTask!('agency', 'owner', { id: 'job', goal: 'Consulta' });
        await runtime.source.planTask!('agency', 'owner', { taskId: 'job', workflow: 'email-lead-v1' });
        const r = await runtime.source.email!.propose('job', 'owner');
        await runtime.source.email!.decide('job', 'owner', { bindingHash: r.review!.bindingHash, decision: 'approved' });
        const unknown = await runtime.source.email!.execute('job', 'owner');
        assert.equal(unknown.status, 'unknown');
        assert.equal(runtime.source.crm!.store.view('owner', { contactId: 'simulated-contact' }).interactions[0]!.state, 'unknown');
        assert.equal(runtime.source.crm!.store.view('owner').followUps.length, 0);
        runtime.close();
        runtime = await openWorkspaceRuntime(join(dir, 'runtime.db'), 'agency', { provider, emailProvider: mail });
        assert.equal(runtime.source.crm!.store.view('owner', { contactId: 'simulated-contact' }).interactions[0]!.state, 'unknown');
        await runtime.source.email!.reconcile('job', 'owner');
        const v = runtime.source.crm!.store.view('owner', { contactId: 'simulated-contact' });
        assert.equal(v.interactions[0]!.state, 'committed');
        assert.equal(v.followUps.length, 1);
        assert.deepEqual(mail.counts(), { sent: 1, calls: 1 });
    }
    finally {
        runtime.close();
        mail.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
test('HTTP cannot forge governed effect evidence or source identity in CRM commands', async () => {
    const f = await fixture();
    try {
        for (const operation of [{ type: 'workflow.effect', taskId: 'job', effectId: 'effect', state: 'committed' }, { ...contact(), source: { kind: 'effect', effectId: 'fake', taskId: 'job' } }]) {
            const r = await f.api.handleAsync({ method: 'POST', path: '/v1/workspaces/agency/crm/commands', authorization: 'Bearer owner-token-123456789', body: { commandId: 'forged', expectedRevision: 0, operation } });
            assert.equal(r.status, 400);
            assert.equal(f.runtime.source.crm!.store.revision('owner'), 0);
        }
    }
    finally {
        await f.done();
    }
});
test('a closed journal backup restores CRM including history without a separate CRM database', async () => {
    const f = await fixture();
    try {
        await f.command(contact(), 'c1');
        await f.command({ type: 'interaction.note', id: 'note', contactId: 'client-1', summary: 'Nota durable' }, 'n1');
        const before = f.runtime.source.crm!.store.view('owner', { contactId: 'client-1' }, NOW);
        f.runtime.close();
        copyFileSync(join(f.dir, 'runtime.db'), join(f.dir, 'restored.db'));
        const restored = await openWorkspaceRuntime(join(f.dir, 'restored.db'), 'agency');
        try {
            assert.deepEqual(restored.source.crm!.store.view('owner', { contactId: 'client-1' }, NOW), before);
        }
        finally {
            restored.close();
        }
    }
    finally {
        await f.done();
    }
});
test('explicit older contact remains visible within a bounded directory result', () => {
    const s = new CrmStore('agency');
    for (let i = 0; i < 205; i++)
        apply(s, contact('c' + String(i).padStart(3, '0'), 'c' + i + '@example.test'), 'create' + i);
    const v = s.view('owner', { contactId: 'c204' });
    assert.equal(v.contacts.length, 200);
    assert.equal(v.contactsTruncated, true);
    assert.ok(v.contacts.some(c => c.id === 'c204'));
    assert.equal(s.view('owner', { query: 'c204@example.test' }).contacts[0]!.id, 'c204');
});
