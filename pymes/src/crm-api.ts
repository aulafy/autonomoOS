import type { WorkspaceApiRequest, WorkspaceApiResponse, WorkspaceRepository, WorkspaceRuntimeSource } from './workspace-api.js';
import { CrmError, crmRecord, crmId, crmText, crmRef, crmRevision, crmEnum, parseCrmCommand } from './crm-contract.js';
export async function handleCrmRequest(request: WorkspaceApiRequest, parts: string[], repository: WorkspaceRepository, runtime: WorkspaceRuntimeSource | undefined): Promise<WorkspaceApiResponse> {
    const token = request.authorization?.startsWith('Bearer ') ? request.authorization.slice(7).trim() : null, principal = token ? repository.findSession(token) : null;
    if (!principal)
        return { status: 401, body: { error: 'UNAUTHENTICATED' } };
    const tenant = parts[2]!;
    if (tenant !== principal.tenantId || principal.role !== 'owner')
        return { status: 403, body: { error: 'PERMISSION_DENIED' } };
    const service = runtime?.crm;
    if (!service || !runtime)
        return { status: 404, body: { error: 'CRM_NOT_CONFIGURED' } };
    const owner = runtime.principalIdForSession(principal), live = () => { const p = repository.findSession(token!); return !!p && p.userId === principal.userId && p.tenantId === tenant && p.role === 'owner'; };
    const done = (body: Record<string, unknown>): WorkspaceApiResponse => live() ? { status: 200, body: { tenantId: tenant, ...body } } : { status: 401, body: { error: 'UNAUTHENTICATED' } };
    try {
        if (request.method === 'GET' && parts.length === 4) {
            const params = new URLSearchParams(request.path.split('?')[1] ?? ''), query = crmText(params.get('q') ?? '', 100, true), cid = params.get('contactId');
            if (cid !== null)
                crmId(cid);
            const taskStatus = crmEnum(params.get('taskStatus') ?? 'pending', ['pending', 'done', 'cancelled', 'all']);
            return done({ ...await service.conversationView(tenant, owner, query, cid, taskStatus, live) });
        }
        if (request.method === 'POST' && parts.length === 5) {
            if (parts[4] === 'commands') {
                const input = parseCrmCommand(request.body);
                return done({ result: service.command(tenant, owner, input) });
            }
            const b = crmRecord(request.body);
            if (parts[4] === 'resolve') {
                if (Object.keys(b).sort().join(',') !== 'accountRef,gmailId')
                    throw new CrmError('CRM_INVALID_INPUT');
                return done({ resolution: await service.resolve(tenant, owner, { accountRef: crmRef(b.accountRef), gmailId: crmId(b.gmailId) }, live) });
            }
            if (parts[4] === 'link') {
                if (Object.keys(b).sort().join(',') !== 'accountRef,commandId,contactId,expectedRevision,gmailId,reviewed' || typeof b.reviewed !== 'boolean')
                    throw new CrmError('CRM_INVALID_INPUT');
                return done({ result: await service.link(tenant, owner, { accountRef: crmRef(b.accountRef), gmailId: crmId(b.gmailId), commandId: crmId(b.commandId), contactId: b.contactId === null ? null : crmId(b.contactId), expectedRevision: crmRevision(b.expectedRevision), reviewed: b.reviewed }, live) });
            }
        }
        return { status: 404, body: { error: 'NOT_FOUND' } };
    }
    catch (e) {
        const code = e instanceof CrmError ? e.message : 'CRM_OPERATION_FAILED';
        if (code === 'CRM_AUTH_CHANGED')
            return { status: 401, body: { error: 'UNAUTHENTICATED' } };
        if (code === 'CRM_SCOPE_DENIED')
            return { status: 403, body: { error: code } };
        return { status: code.startsWith('CRM_INVALID') ? 400 : 409, body: { error: code } };
    }
}
