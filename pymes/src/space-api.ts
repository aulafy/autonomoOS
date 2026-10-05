import type { WorkspaceApiRequest, WorkspaceApiResponse, WorkspaceRepository, WorkspaceRuntimeSource } from './workspace-api.js';
import { CapsuleError } from './capsule-sdk.js';

/** Presentation preferences do not grant permissions, connect accounts, or stop durable jobs. */
export function handleSpaceRequest(request: WorkspaceApiRequest, parts: string[], repo: WorkspaceRepository, runtime?: WorkspaceRuntimeSource): WorkspaceApiResponse {
  const token = request.authorization?.startsWith('Bearer ') ? request.authorization.slice(7).trim() : null;
  const principal = token ? repo.findSession(token) : null;
  if (!principal) return { status: 401, body: { error: 'UNAUTHENTICATED' } };
  if (principal.tenantId !== parts[2] || principal.role !== 'owner') return { status: 403, body: { error: 'PERMISSION_DENIED' } };
  if (!runtime?.capsules) return { status: 404, body: { error: 'SPACE_NOT_CONFIGURED' } };
  try {
    const owner = runtime.principalIdForSession(principal), tenant = principal.tenantId;
    if (request.method === 'GET' && parts.length === 4) return { status: 200, body: { ...runtime.capsules.space(tenant, owner) } };
    if (request.method === 'POST' && parts.length === 5 && parts[4] === 'configure') {
      return { status: 200, body: { ...runtime.capsules.configureSpace(tenant, owner, request.body) } };
    }
    return { status: 404, body: { error: 'NOT_FOUND' } };
  } catch (error) {
    const code = error instanceof CapsuleError ? error.message : 'SPACE_OPERATION_FAILED';
    return { status: ['SPACE_INVALID_INPUT', 'SPACE_DEPENDENCY_REQUIRED', 'CAPSULE_INVALID_INPUT'].includes(code) ? 400 : code === 'CAPSULE_SCOPE_DENIED' ? 403 : 409, body: { error: code } };
  }
}
