/** Local QA only. Synthetic CRM, no provider dispatch, OAuth, Keychain or real inbox. */
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { openWorkspaceRuntime } from '../../src/runtime-source.js';
import { WorkspaceApi, InMemoryWorkspaceRepository } from '../../src/workspace-api.js';
import { handlePymesRequest } from '../../src/api-server.js';
const [dir, rawPort = '8938'] = process.argv.slice(2); if (!dir) throw new Error('QA_DIRECTORY_REQUIRED');
const port = Number(rawPort); if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('QA_INVALID_PORT');
const runtime = await openWorkspaceRuntime(dir + '/runtime.db', 'capsules-qa');
const repo = new InMemoryWorkspaceRepository(); repo.addSession('capsules-qa-token-123456789', { userId: 'qa-owner', tenantId: 'capsules-qa', role: 'owner' });
const crm = runtime.source.crm!;
if (crm.store.revision('qa-owner') === 0) for (const [id, name, relationship] of [['a', 'Estudio Oliva · QA', 'client'], ['b', 'Marina Ruiz · QA', 'prospect'], ['c', 'Taller Norte · QA', 'client']] as const) {
  crm.command('capsules-qa', 'qa-owner', { commandId: 'seed-' + id, expectedRevision: crm.store.revision('qa-owner'), operation: { type: 'contact.create', id, name, email: '', phone: '', notes: 'Datos sintéticos de QA', relationship } });
}
const api = new WorkspaceApi(repo, undefined, runtime.source);
const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = []; for await (const b of req) chunks.push(Buffer.from(b)); const body = Buffer.concat(chunks);
    const response = await handlePymesRequest(api, new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method, headers: req.headers as Record<string, string>, ...(body.length ? { body } : {}) }),
      { allowedOrigins: ['http://127.0.0.1:5177', 'http://127.0.0.1:5181'] });
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text());
  } catch { res.writeHead(500); res.end(); }
});
server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ qa: true, port, tenant: 'capsules-qa', syntheticToken: 'capsules-qa-token-123456789' })));
const input = createInterface({ input: process.stdin }); input.on('line', line => {
  if (line === 'error') { crm.close(); console.log('QA_CRM_CLOSED'); }
  if (line === 'space-race') {
    const space = runtime.source.capsules!.space('capsules-qa', 'qa-owner');
    runtime.source.capsules!.configureSpace('capsules-qa', 'qa-owner', { commandId: 'qa-race-' + Date.now(), expectedRevision: space.revision, name: 'Otra sesión QA', templateId: 'custom', modules: ['crm'] });
    console.log('QA_SPACE_CONCURRENT_CHANGE');
  }
  if (line === 'revoke') { repo.revokeSession('capsules-qa-token-123456789'); console.log('QA_SESSION_REVOKED'); }
  if (line === 'stop') { server.close(); input.close(); runtime.close(); }
});
