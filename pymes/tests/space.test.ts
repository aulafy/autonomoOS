import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CapsuleStore } from '../src/capsule-store.js';
import { defaultSpace, exportSpaceRecipe, parseSpaceRecipe, parseSpaceCommand, parseSpaceView, toggleSpaceModule, type SpaceCommand } from '../src/space-contract.js';
import { openWorkspaceRuntime } from '../src/runtime-source.js';
import { WorkspaceApi, InMemoryWorkspaceRepository } from '../src/workspace-api.js';
import { WorkspaceClient } from '../src/workspace-client.js';
import { handlePymesRequest } from '../src/api-server.js';

const command = (changes: Partial<SpaceCommand> = {}): SpaceCommand => ({ ...defaultSpace(), commandId: 'organize', expectedRevision: 0, ...changes });
const scratch = () => { const dir = mkdtempSync(join(tmpdir(), 'space-qa-')); return { dir, path: join(dir, 'capsules.db'), close: () => rmSync(dir, { recursive: true, force: true }) }; };
test('space rejects arbitrary routes, unknown modules, duplicates, scopes and missing dependencies', () => {
  for (const change of [{ route: 'https://evil.invalid' }, { owner: 'other' }, { grants: ['email.send'] },
    { modules: ['unknown'] }, { modules: ['crm', 'crm'] }, { name: 'line\nbreak' }, { templateId: 'unknown' }]) {
    assert.throws(() => parseSpaceCommand({ ...command(), ...change }));
  }
  assert.throws(() => parseSpaceCommand(command({ modules: ['followups'] })), /DEPENDENCY_REQUIRED/);
  assert.deepEqual(parseSpaceCommand(command({ modules: [] })).modules, []);
});
test('module toggles add dependencies and remove dependent entries while preserving order', () => {
  assert.deepEqual(toggleSpaceModule(['gmail'], 'followups', true), ['gmail', 'crm', 'followups']);
  assert.deepEqual(toggleSpaceModule(['crm', 'followups', 'gmail'], 'crm', false), ['gmail']);
  assert.deepEqual(toggleSpaceModule(['crm', 'followups'], 'gmail', true), ['crm', 'followups', 'gmail']);
});
test('portable organization round-trips only reviewed settings without identity or credentials', () => {
  const settings = { ...defaultSpace(), name: 'Plantilla QA', modules: ['crm', 'gmail'] as const };
  const recipe = exportSpaceRecipe({ ...settings, modules: [...settings.modules] });
  assert.deepEqual(parseSpaceRecipe(recipe), settings);
  assert.deepEqual(Object.keys(JSON.parse(recipe)).sort(), ['schemaVersion', 'settings']);
  assert.deepEqual(Object.keys(JSON.parse(recipe).settings).sort(), ['modules', 'name', 'templateId']);
});
test('recipe import rejects executable or privileged content, wrong schema and oversized files', () => {
  for (const value of [ { schemaVersion: 2, settings: defaultSpace() },
    { schemaVersion: 1, settings: defaultSpace(), code: 'fetch()' },
    { schemaVersion: 1, settings: { ...defaultSpace(), token: 'forbidden' } },
    { schemaVersion: 1, settings: { ...defaultSpace(), modules: ['email.send'] } },
    { schemaVersion: 1, settings: { ...defaultSpace(), modules: ['followups'] } } ]) assert.throws(() => parseSpaceRecipe(JSON.stringify(value)));
  assert.throws(() => parseSpaceRecipe('invalid')); assert.throws(() => parseSpaceRecipe(' '.repeat(8193)));
});
test('space organization, receipt and history persist atomically and retries are idempotent', () => {
  const f = scratch(); let store = new CapsuleStore(f.path, 'agency', undefined, () => 1000);
  try {
    assert.equal(store.space('agency', 'owner').configured, false);
    const input = command({ name: 'Estudio QA', templateId: 'consulting', modules: ['crm', 'followups', 'gmail'] });
    const receipt = store.configureSpace('agency', 'owner', input);
    assert.deepEqual(store.configureSpace('agency', 'owner', input), receipt);
    assert.throws(() => store.configureSpace('agency', 'owner', { ...input, name: 'Other' }), /COMMAND_CONFLICT/);
    assert.equal(store.catalog('agency', 'owner').revision, 0);
    store.close(); store = new CapsuleStore(f.path, 'agency');
    assert.deepEqual(store.configureSpace('agency', 'owner', input), receipt);
    const view = store.space('agency', 'owner'); assert.equal(view.revision, 1); assert.equal(view.history.length, 1);
    assert.equal(view.history[0]!.actor, 'owner'); assert.equal(view.history[0]!.at, 1000);
    assert.deepEqual(view.settings.modules, ['crm', 'followups', 'gmail']);
  } finally { store.close(); f.close(); }
});
test('separate owners, tenants and competing connections cannot overwrite organization', () => {
  const f = scratch(), a = new CapsuleStore(f.path, 'agency'), b = new CapsuleStore(f.path, 'agency');
  try {
    a.configureSpace('agency', 'owner', command());
    assert.throws(() => b.configureSpace('agency', 'owner', command({ commandId: 'racing' })), /REVISION_CONFLICT/);
    assert.equal(b.space('agency', 'other').revision, 0);
    assert.throws(() => a.configureSpace('foreign', 'owner', command()), /SCOPE_DENIED/);
    assert.throws(() => b.space('foreign', 'owner'), /SCOPE_DENIED/);
  } finally { a.close(); b.close(); f.close(); }
});
test('additive schema preserves existing capsule installation and decisions', () => {
  const f = scratch(), db = new DatabaseSync(f.path);
  const installation = { id: 'crm.client-summary', version: '1.0.0', enabled: true, grants: ['database.query'], config: { title: 'Old', limit: 12, relationship: 'all' }, updatedAt: 1000 };
  db.exec(`CREATE TABLE capsule_meta(tenant TEXT PRIMARY KEY); INSERT INTO capsule_meta VALUES('agency');
    CREATE TABLE capsule_owners(owner TEXT PRIMARY KEY, revision INTEGER NOT NULL); INSERT INTO capsule_owners VALUES('owner',1);
    CREATE TABLE capsule_installations(owner TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(owner,id));
    CREATE TABLE capsule_commands(owner TEXT NOT NULL,id TEXT NOT NULL,input TEXT NOT NULL,result TEXT NOT NULL,audit TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(owner,id));`);
  db.prepare('INSERT INTO capsule_installations VALUES(?,?,?)').run('owner', installation.id, JSON.stringify(installation)); db.close();
  const store = new CapsuleStore(f.path, 'agency');
  try { assert.deepEqual(store.catalog('agency', 'owner').items[0]!.installation, installation); assert.equal(store.space('agency', 'owner').revision, 0);
    store.configureSpace('agency', 'owner', command({ modules: [] })); assert.deepEqual(store.catalog('agency', 'owner').items[0]!.installation, installation);
  } finally { store.close(); f.close(); }
});
async function fixture() {
  const f = scratch(); let runtime = await openWorkspaceRuntime(join(f.dir, 'runtime.db'), 'agency');
  const repo = new InMemoryWorkspaceRepository();
  for (const [token, owner, tenant, role] of [['space-owner-token-123456', 'owner', 'agency', 'owner'], ['space-other-token-123456', 'other', 'agency', 'owner'], ['space-review-token-123456', 'review', 'agency', 'reviewer'], ['space-foreign-token-123456', 'foreign', 'foreign', 'owner']] as const) repo.addSession(token, { userId: owner, tenantId: tenant, role });
  let api = new WorkspaceApi(repo, undefined, runtime.source);
  const client = (token = 'space-owner-token-123456') => new WorkspaceClient({ baseUrl: 'http://127.0.0.1', tenantId: 'agency', token }, (i,o) => handlePymesRequest(api, new Request(String(i),o)));
  return { client, repo, get api() { return api; }, get runtime() { return runtime; }, async reopen() { runtime.close(); runtime = await openWorkspaceRuntime(join(f.dir, 'runtime.db'), 'agency'); api = new WorkspaceApi(repo, undefined, runtime.source); }, close() { runtime.close(); f.close(); } };
}
test('space API requires the correct owner session and does not accept owner spoofing', async () => {
  const f = await fixture(); try {
    for (const [token, status] of [[null,401], ['space-review-token-123456',403], ['space-foreign-token-123456',403]] as const) {
      for (const [method, path] of [['GET','space'], ['POST','space/configure']] as const) assert.equal((await f.api.handleAsync({ method, path: '/v1/workspaces/agency/'+path, authorization: token ? 'Bearer '+token : undefined, body: command() })).status, status);
    }
    assert.equal((await f.api.handleAsync({ method: 'POST', path: '/v1/workspaces/agency/space/configure', authorization: 'Bearer space-owner-token-123456', body: { ...command(), owner: 'other' } })).status, 400);
    f.repo.revokeSession('space-owner-token-123456'); await assert.rejects(f.client().space(), /UNAUTHENTICATED/);
  } finally { f.close(); }
});
test('presentation changes preserve durable runtime jobs, CRM, capsule grants and replay', async () => {
  const f = await fixture(); try {
    const client = f.client(); await client.createRuntimeTask({ id: 'work-qa', goal: 'Trabajo sintético que debe conservarse' });
    const before = f.runtime.kernel.snapshot(), crm = await client.crm(), capsules = await client.capsules();
    await client.configureSpace(command({ name: 'Solo revisión QA', modules: [], templateId: 'custom' }));
    assert.deepEqual(f.runtime.kernel.snapshot(), before); assert.deepEqual(await client.crm(), crm); assert.deepEqual(await client.capsules(), capsules);
    assert.equal((await f.client('space-other-token-123456').space()).configured, false);
    assert.equal((await client.runtimeView()).tasks.length, 1);
    await f.reopen(); assert.deepEqual(f.runtime.kernel.snapshot(), before); assert.equal((await client.space()).settings.name, 'Solo revisión QA');
    assert.equal((await client.reviewQueue()).total, 1);
  } finally { f.close(); }
});
test('space client rejects crossed tenants, inconsistent history and fake configuration receipts', async () => {
  const empty = { tenantId: 'agency', ownerId: 'owner', configured: false, revision: 0, settings: defaultSpace(), history: [] };
  assert.throws(() => parseSpaceView({ ...empty, tenantId: 'foreign' }, 'agency'));
  assert.throws(() => parseSpaceView({ ...empty, revision: 1, configured: true }, 'agency'));
  assert.throws(() => parseSpaceView({ ...empty, settings: { ...defaultSpace(), modules: ['followups'] } }, 'agency'));
  const client = new WorkspaceClient({ baseUrl: 'http://127.0.0.1', tenantId: 'agency', token: 'space-owner-token-123456' }, async () => Response.json({ tenantId: 'agency', ownerId: 'owner', revision: 1, settings: { ...defaultSpace(), name: 'Unexpected' } }));
  await assert.rejects(client.configureSpace(command()), /SPACE_INVALID_INPUT/);
});
