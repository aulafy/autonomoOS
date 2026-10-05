import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CapsuleStore } from '../src/capsule-store.js';
import { CapsuleRegistry, clientSummaryCapsule } from '../src/capsule-registry.js';
import { defineCapsule, parseCapsuleCommand, parseCapsuleCatalog, parseClientSummary, capsuleRoute, type CapsuleCommand } from '../src/capsule-sdk.js';
import { capsuleDevelopmentKit } from '../src/capsule-kit.js';
import { openWorkspaceRuntime } from '../src/runtime-source.js';
import { WorkspaceApi, InMemoryWorkspaceRepository } from '../src/workspace-api.js';
import { WorkspaceClient } from '../src/workspace-client.js';
import { prospectSummary } from '../examples/capsules/prospect-summary.js';
import { handlePymesRequest } from '../src/api-server.js';

export const command = (changes: Partial<CapsuleCommand> = {}): CapsuleCommand => ({ commandId: 'install-one', expectedRevision: 0,
  capsuleId: clientSummaryCapsule.id, version: clientSummaryCapsule.version, enabled: true,
  grants: ['database.query'], config: { title: 'Mi cartera', limit: 12, relationship: 'all' }, ...changes });
function temporary() { const dir = mkdtempSync(join(tmpdir(), 'capsules-')); return { dir, path: join(dir, 'capsules.db'), done: () => rmSync(dir, { recursive: true, force: true }) }; }

test('capsules reject incompatible SDKs, executable manifests and escalated capabilities', () => {
  assert.throws(() => defineCapsule({ ...clientSummaryCapsule, sdkVersion: 2 }), /SDK_INCOMPATIBLE/);
  assert.throws(() => defineCapsule({ ...clientSummaryCapsule, code: 'fetch()' }), /INVALID_INPUT/);
  assert.throws(() => defineCapsule({ ...clientSummaryCapsule, capabilities: ['http.request'] }), /INVALID_INPUT/);
  assert.throws(() => defineCapsule({ ...clientSummaryCapsule, resources: ['all.accounts'] }), /INVALID_INPUT/);
  assert.throws(() => defineCapsule(Object.assign(Object.create({ code: 'inherited' }), clientSummaryCapsule)), /INVALID_INPUT/);
});
test('capsule config rejects secrets, prototype keys, unbounded output and invalid filters', () => {
  for (const config of [{ ...command().config, token: 'not-allowed' }, { ...command().config, limit: 0 },
    { ...command().config, limit: 51 }, { ...command().config, relationship: new String('client') },
    { ...command().config, title: 'line\nbreak' }, JSON.parse('{"title":"ok","limit":12,"relationship":"all","__proto__":{}}')]) {
    assert.throws(() => parseCapsuleCommand(command({ config: config as CapsuleCommand['config'] })), /INVALID_INPUT/);
  }
});
test('registry rejects duplicate identities and returns independent definitions', () => {
  const registry = new CapsuleRegistry(); assert.throws(() => registry.register(clientSummaryCapsule), /ID_CONFLICT/);
  registry.get(clientSummaryCapsule.id).defaults.title = 'tampered';
  assert.equal(registry.get(clientSummaryCapsule.id).defaults.title, 'Mis clientes');
  assert.notEqual(capsuleRoute('a.b-c'), capsuleRoute('a-b.c'));
});
test('installation and its audit are durable and a repeated exact command is idempotent', () => {
  const f = temporary(); let store = new CapsuleStore(f.path, 'agency', undefined, () => 1000);
  try {
    const saved = store.apply('agency', 'owner', command());
    assert.deepEqual(store.apply('agency', 'owner', command()), saved);
    assert.throws(() => store.apply('agency', 'owner', command({ enabled: false })), /COMMAND_CONFLICT/);
    store.close(); store = new CapsuleStore(f.path, 'agency');
    assert.deepEqual(store.apply('agency', 'owner', command()), saved);
    const view = store.catalog('agency', 'owner'); assert.equal(view.revision, 1); assert.equal(view.audit.length, 1);
    assert.equal(view.audit[0]!.actor, 'owner'); assert.equal(view.items[0]!.installation!.config.title, 'Mi cartera');
  } finally { store.close(); f.done(); }
});
test('two database connections use revisions to prevent lost configuration changes', () => {
  const f = temporary(), a = new CapsuleStore(f.path, 'agency'), b = new CapsuleStore(f.path, 'agency');
  try { a.apply('agency', 'owner', command());
    assert.throws(() => b.apply('agency', 'owner', command({ commandId: 'competing' })), /REVISION_CONFLICT/);
    assert.equal(b.catalog('agency', 'owner').revision, 1);
  } finally { a.close(); b.close(); f.done(); }
});
test('configuration, decisions and resources are isolated by tenant and owner', () => {
  const f = temporary(), store = new CapsuleStore(f.path, 'agency');
  try { store.apply('agency', 'owner', command());
    assert.equal(store.catalog('agency', 'other').items[0]!.installation, null);
    assert.equal(store.catalog('agency', 'other').audit.length, 0);
    assert.throws(() => store.apply('foreign', 'owner', command()), /SCOPE_DENIED/);
    assert.throws(() => new CapsuleStore(f.path, 'foreign'), /SCOPE_DENIED/);
  } finally { store.close(); f.done(); }
});
test('a new available capsule version requires explicit configuration and preserves audit', () => {
  const f = temporary(); let store = new CapsuleStore(f.path, 'agency');
  try {
    store.apply('agency', 'owner', command()); store.close();
    store = new CapsuleStore(f.path, 'agency', new CapsuleRegistry([{ ...clientSummaryCapsule, version: '1.1.0' }]));
    const old = parseCapsuleCatalog(store.catalog('agency', 'owner'), 'agency');
    assert.equal(old.items[0]!.installation!.version, '1.0.0');
    assert.equal(store.apply('agency', 'owner', command()).revision, 1);
    assert.throws(() => store.apply('agency', 'owner', command({ commandId: 'old-version', expectedRevision: 1 })), /VERSION_CONFLICT/);
    store.apply('agency', 'owner', command({ commandId: 'upgrade', expectedRevision: 1, version: '1.1.0' }));
    assert.deepEqual(store.catalog('agency', 'owner').audit.map(a => a.version), ['1.1.0', '1.0.0']);
  } finally { store.close(); f.done(); }
});
async function fixture() {
  const f = temporary(); let runtime = await openWorkspaceRuntime(join(f.dir, 'runtime.db'), 'agency');
  const repo = new InMemoryWorkspaceRepository();
  for (const [token, userId, tenantId, role] of [['owner-token-123456789', 'owner', 'agency', 'owner'],
    ['other-token-123456789', 'other', 'agency', 'owner'], ['review-token-123456789', 'reviewer', 'agency', 'reviewer'],
    ['foreign-token-123456789', 'foreign', 'foreign', 'owner']] as const) repo.addSession(token, { userId, tenantId, role });
  let api = new WorkspaceApi(repo, undefined, runtime.source);
  const client = (token = 'owner-token-123456789') => new WorkspaceClient({ baseUrl: 'http://127.0.0.1', tenantId: 'agency', token },
    (i, o) => handlePymesRequest(api, new Request(String(i), o)));
  const owner = client();
  await owner.crmCommand({ commandId: 'seed-a', expectedRevision: 0, operation: { type: 'contact.create', id: 'a', name: 'Cliente QA', email: '', phone: '', notes: '', relationship: 'client' } });
  await owner.crmCommand({ commandId: 'seed-b', expectedRevision: 1, operation: { type: 'contact.create', id: 'b', name: 'Prospecto QA', email: '', phone: '', notes: '', relationship: 'prospect' } });
  return { client, owner, repo, get runtime() { return runtime; }, get api() { return api; },
    async reopen() { runtime.close(); runtime = await openWorkspaceRuntime(join(f.dir, 'runtime.db'), 'agency'); api = new WorkspaceApi(repo, undefined, runtime.source); },
    done() { runtime.close(); f.done(); } };
}
test('capsule API requires an owner session and denies foreign or revoked sessions', async () => {
  const f = await fixture(); try {
    for (const [authorization, status] of [[undefined, 401], ['Bearer review-token-123456789', 403], ['Bearer foreign-token-123456789', 403]] as const) {
      assert.equal((await f.api.handleAsync({ method: 'GET', path: '/v1/workspaces/agency/capsules', authorization })).status, status);
      assert.equal((await f.api.handleAsync({ method: 'POST', path: '/v1/workspaces/agency/capsules/configure', authorization, body: command() })).status, status);
    }
    f.repo.revokeSession('owner-token-123456789'); await assert.rejects(f.owner.capsules(), /UNAUTHENTICATED/);
  } finally { f.done(); }
});
test('the first capsule reads real CRM projections with no runtime or CRM mutations', async () => {
  const f = await fixture(); try {
    const state = f.runtime.kernel.snapshot(), before = await f.owner.crm();
    await assert.rejects(f.owner.capsuleView(clientSummaryCapsule.id), /CAPSULE_DISABLED/);
    await f.owner.configureCapsule(command({ config: { title: 'Clientes del estudio', limit: 1, relationship: 'client' } }));
    const view = await f.owner.capsuleView(clientSummaryCapsule.id);
    assert.equal(view.title, 'Clientes del estudio'); assert.deepEqual(view.contacts.map(c => c.id), ['a']);
    assert.equal(view.counts.contacts, 2); assert.deepEqual(await f.owner.crm(), before); assert.deepEqual(f.runtime.kernel.snapshot(), state);
    await assert.rejects(f.client('other-token-123456789').capsuleView(clientSummaryCapsule.id), /CAPSULE_DISABLED/);
    assert.equal((await f.client('other-token-123456789').capsules()).revision, 0);
    await f.reopen(); assert.deepEqual(await f.owner.capsuleView(clientSummaryCapsule.id), view);
    assert.deepEqual(f.runtime.kernel.snapshot(), state);
  } finally { f.done(); }
});
test('a reviewed derived capsule reuses the renderer and keeps its own configuration', async () => {
  const f = await fixture(); try {
    f.runtime.source.capsules!.registry.register(prospectSummary);
    await f.owner.configureCapsule(command());
    await f.owner.configureCapsule(command({ commandId: 'derived', expectedRevision: 1, capsuleId: 'custom.prospect-summary', config: { title: 'Mi actividad comercial', limit: 5, relationship: 'prospect' } }));
    assert.deepEqual((await f.owner.capsuleView('custom.prospect-summary')).contacts.map(c => c.id), ['b']);
    assert.equal((await f.owner.capsuleView(clientSummaryCapsule.id)).contacts.length, 2);
    assert.equal((await f.owner.capsules()).items.length, 2);
  } finally { f.done(); }
});
test('deactivation blocks the real data endpoint while preserving previous decisions', async () => {
  const f = await fixture(); try {
    await f.owner.configureCapsule(command());
    await f.owner.configureCapsule(command({ commandId: 'disable', expectedRevision: 1, enabled: false }));
    await assert.rejects(f.owner.capsuleView(clientSummaryCapsule.id), /CAPSULE_DISABLED/);
    const view = await f.owner.capsules(); assert.equal(view.audit.length, 2); assert.equal(view.items[0]!.installation!.enabled, false);
    await f.reopen(); await assert.rejects(f.owner.capsuleView(clientSummaryCapsule.id), /CAPSULE_DISABLED/);
  } finally { f.done(); }
});
test('resource failure and malformed or escalated requests fail without returning demo data', async () => {
  const f = await fixture(); try {
    const request = (body: unknown) => f.api.handleAsync({ method: 'POST', path: '/v1/workspaces/agency/capsules/configure', authorization: 'Bearer owner-token-123456789', body });
    assert.equal((await request({ ...command(), owner: 'other' })).status, 400);
    assert.equal((await request({ ...command(), grants: ['http.request'] })).status, 400);
    assert.equal((await request({ ...command(), capsuleId: 'unknown.capsule' })).status, 404);
    assert.equal((await f.owner.capsules()).revision, 0);
    await f.owner.configureCapsule(command()); f.runtime.source.crm!.close();
    await assert.rejects(f.owner.capsuleView(clientSummaryCapsule.id), /CAPSULE_OPERATION_FAILED/);
    await f.owner.configureCapsule(command({ commandId: 'disable-unavailable', expectedRevision: 1, enabled: false }));
    await assert.rejects(f.owner.capsuleView(clientSummaryCapsule.id), /CAPSULE_DISABLED/);
    assert.equal((await f.owner.capsules()).revision, 2);
  } finally { f.done(); }
});
test('browser contracts reject crossed tenants, mismatched receipts and invalid contact data', async () => {
  assert.throws(() => parseCapsuleCatalog({ tenantId: 'other', items: [], audit: [], revision: 0, ownerId: 'owner' }, 'agency'), /INVALID_INPUT/);
  const c = new WorkspaceClient({ baseUrl: 'http://127.0.0.1', tenantId: 'agency', token: 'owner-token-123456789' },
    async () => Response.json({ tenantId: 'other', revision: 1, installation: { ...command(), id: clientSummaryCapsule.id, updatedAt: 0 } }));
  await assert.rejects(c.configureCapsule(command()), /INVALID_INPUT/);
  assert.throws(() => parseClientSummary({ tenantId: 'agency', capsuleId: clientSummaryCapsule.id, contacts: [{ id: 'a', name: 'one', phone: {}, relationship: 'client' }], counts: {}, truncated: false }, 'agency', clientSummaryCapsule.id), /INVALID_INPUT/);
});
test('developer kit contains the real contracts and a valid reusable manifest without workspace data', () => {
  const sdk = readFileSync(new URL('../src/capsule-sdk.ts', import.meta.url), 'utf8'), crm = readFileSync(new URL('../src/crm-contract.ts', import.meta.url), 'utf8');
  const kit = capsuleDevelopmentKit(clientSummaryCapsule, sdk, crm);
  assert.ok(kit.includes(sdk)); assert.ok(kit.includes(crm));
  const block = kit.match(/defineCapsule\((\{[\s\S]*?\})\);/)![1]!;
  assert.equal(defineCapsule(JSON.parse(block)).id, 'custom.client-summary');
  assert.ok(!kit.includes('owner-token-123456789')); assert.ok(!kit.includes('Cliente QA'));
});
