import type { WorkspaceApiRequest, WorkspaceApiResponse, WorkspaceRepository, WorkspaceRuntimeSource } from './workspace-api.js';
import { CapsuleError, capsuleId, parseCapsuleCommand, projectClientSummary } from './capsule-sdk.js';

export function handleCapsuleRequest(request: WorkspaceApiRequest, parts: string[], repo: WorkspaceRepository, runtime?: WorkspaceRuntimeSource): WorkspaceApiResponse {
  const token = request.authorization?.startsWith('Bearer ') ? request.authorization.slice(7).trim() : null;
  const principal = token ? repo.findSession(token) : null;
  if (!principal) return { status: 401, body: { error: 'UNAUTHENTICATED' } };
  const tenant = parts[2]!;
  if (tenant !== principal.tenantId || principal.role !== 'owner') return { status: 403, body: { error: 'PERMISSION_DENIED' } };
  if (!runtime?.capsules) return { status: 404, body: { error: 'CAPSULES_NOT_CONFIGURED' } };
  try {
    const owner = runtime.principalIdForSession(principal), store = runtime.capsules;
    if (request.method === 'GET' && parts.length === 4) return { status: 200, body: { ...store.catalog(tenant, owner) } };
    if (request.method === 'POST' && parts.length === 5 && parts[4] === 'configure') {
      const input = parseCapsuleCommand(request.body);
      // Deactivation remains available when the CRM is unavailable.
      // Activation grants only the reviewed CRM projection, never arbitrary database access.
      if (input.enabled) {
        if (!runtime.crm) throw new CapsuleError('CAPSULE_RESOURCE_UNAVAILABLE');
        runtime.crm.view(tenant, owner, '', null, 'pending');
      }
      const result = store.apply(tenant, owner, input);
      return { status: 200, body: { tenantId: tenant, ...result } };
    }
    if (request.method === 'GET' && parts.length === 6 && parts[5] === 'view') {
      const id = capsuleId(parts[4]), catalog = store.catalog(tenant, owner), item = catalog.items.find(i => i.manifest.id === id);
      if (!item) throw new CapsuleError('CAPSULE_NOT_FOUND');
      if (!item.installation?.enabled) throw new CapsuleError('CAPSULE_DISABLED');
      if (item.installation.version !== item.manifest.version) throw new CapsuleError('CAPSULE_VERSION_CONFLICT');
      if (!runtime.crm) throw new CapsuleError('CAPSULE_RESOURCE_UNAVAILABLE');
      const view = runtime.crm.view(tenant, owner, '', null, 'pending');
      return { status: 200, body: { tenantId: tenant, ...projectClientSummary(view, item.installation, catalog.revision) } };
    }
    return { status: 404, body: { error: 'NOT_FOUND' } };
  } catch (error) {
    const code = error instanceof CapsuleError ? error.message : 'CAPSULE_OPERATION_FAILED';
    return { status: code === 'CAPSULE_INVALID_INPUT' ? 400 : code === 'CAPSULE_SCOPE_DENIED' ? 403 : code === 'CAPSULE_NOT_FOUND' ? 404 : 409, body: { error: code } };
  }
}
