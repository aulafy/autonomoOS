import { crmRecord, crmId, crmText, crmRevision, crmTime, crmEnum, crmRef, normalizeCrmEmail, CRM_LINES, CRM_LEAD_STATES, type CrmSource, type CrmMailTrace, type CrmView } from './crm-contract.js';
function bool(v: unknown): boolean {
    if (typeof v !== 'boolean')
        throw new Error('INVALID_CRM_RESPONSE');
    return v;
}
function rows(v: unknown, max: number): Record<string, unknown>[] {
    if (!Array.isArray(v) || v.length > max)
        throw new Error('INVALID_CRM_RESPONSE');
    return v.map(crmRecord);
}
function source(v: unknown): CrmSource {
    const s = crmRecord(v);
    if (s.kind === 'user')
        return { kind: 'user' };
    if (s.kind === 'gmail')
        return { kind: 'gmail', accountRef: crmRef(s.accountRef), gmailId: crmId(s.gmailId) };
    if (s.kind === 'effect')
        return { kind: 'effect', effectId: crmId(s.effectId), taskId: crmId(s.taskId) };
    throw new Error('INVALID_CRM_RESPONSE');
}
function base(v: Record<string, unknown>) { return { id: crmId(v.id), contactId: crmId(v.contactId), createdAt: crmTime(v.createdAt), updatedAt: crmTime(v.updatedAt), source: source(v.source) }; }
export function parseCrmView(raw: unknown, tenant: string, selected: string | null): CrmView {
    const v = crmRecord(raw);
    if (v.tenantId !== tenant || v.selectedContactId !== selected)
        throw new Error('INVALID_CRM_RESPONSE');
    const contacts = rows(v.contacts, 200).map(c => ({ id: crmId(c.id), name: crmText(c.name, 200), phone: crmText(c.phone, 100, true), notes: crmText(c.notes, 2000, true), relationship: crmEnum(c.relationship, ['prospect', 'client'] as const), status: crmEnum(c.status, ['active', 'archived'] as const), createdAt: crmTime(c.createdAt), updatedAt: crmTime(c.updatedAt), version: crmRevision(c.version), source: source(c.source) }));
    const identities = rows(v.identities, 100).map(i => {
        if (i.verified !== false)
            throw new Error('INVALID_CRM_RESPONSE');
        return { id: crmId(i.id), contactId: crmId(i.contactId), email: normalizeCrmEmail(i.email), active: bool(i.active), verified: false as const, source: source(i.source), createdAt: crmTime(i.createdAt) };
    });
    const leads = rows(v.leads, 100).map(l => ({ ...base(l), title: crmText(l.title, 300), line: crmEnum(l.line, CRM_LINES), status: crmEnum(l.status, CRM_LEAD_STATES) }));
    const interactions = rows(v.interactions, 100).map(i => ({ ...base(i), direction: crmEnum(i.direction, ['incoming', 'outgoing', 'note'] as const), state: crmEnum(i.state, ['received', 'committed', 'unknown', 'failed', 'note'] as const), summary: crmText(i.summary, 2000), ...(i.trace !== undefined ? {trace: parseCrmMailTrace(i.trace, source(i.source), String(i.state))} : {}) }));
    const followUps = rows(v.followUps, 100).map(f => ({ ...base(f), title: crmText(f.title, 300), leadId: f.leadId === null ? null : crmId(f.leadId), dueAt: crmTime(f.dueAt), status: crmEnum(f.status, ['pending', 'done', 'cancelled'] as const) }));
    const links = rows(v.links, 100).map(l => ({ accountRef: crmRef(l.accountRef), gmailId: crmId(l.gmailId), contactId: l.contactId === null ? null : crmId(l.contactId), interactionId: l.interactionId === null ? null : crmId(l.interactionId), updatedAt: crmTime(l.updatedAt), automatic: bool(l.automatic) }));
    const audit = rows(v.audit, 50).map(a => ({ commandId: crmId(a.commandId), operation: crmText(a.operation, 80), contactId: a.contactId === null ? null : crmId(a.contactId), at: crmTime(a.at), source: source(a.source), revision: crmRevision(a.revision) }));
    if (new Set(contacts.map(c => c.id)).size !== contacts.length || [...identities, ...leads, ...interactions, ...links].some(r => r.contactId !== selected))
        throw new Error('INVALID_CRM_RESPONSE');
    if (selected && followUps.some(r => r.contactId !== selected))
        throw new Error('INVALID_CRM_RESPONSE');
    const c = crmRecord(v.counts);
    return { revision: crmRevision(v.revision), contacts, totalContacts: crmRevision(v.totalContacts), contactsTruncated: bool(v.contactsTruncated), selectedContactId: selected, identities, leads, interactions, followUps, followUpsTotal: crmRevision(v.followUpsTotal), followUpsTruncated: bool(v.followUpsTruncated), links, audit, counts: { contacts: crmRevision(c.contacts), leads: crmRevision(c.leads), pending: crmRevision(c.pending), overdue: crmRevision(c.overdue) } };
}
/** A malformed provenance response is an API error, never a demo fallback. */
export function parseCrmMailTrace(raw: unknown, origin: CrmSource, state: string): CrmMailTrace {
    const r = crmRecord(raw);
    const delivery = crmEnum(r.delivery, ['gmail_verified', 'gmail_unverified', 'simulation', 'unclassified', 'gmail_imported', 'note'] as const);
    const m = r.mail === null ? null : crmRecord(r.mail);
    const mail = m ? {accountRef: crmRef(m.accountRef), gmailId: crmId(m.gmailId), threadId: crmId(m.threadId)} : null;
    const observationId = r.observationId === null ? null : crmId(r.observationId);
    if ((delivery === 'note' && origin.kind !== 'user') || (delivery === 'gmail_imported' && origin.kind !== 'gmail') ||
        (['gmail_verified', 'gmail_unverified', 'simulation'].includes(delivery) && origin.kind !== 'effect') ||
        (delivery === 'gmail_verified' && (state !== 'committed' || !observationId)) ||
        (delivery !== 'gmail_verified' && observationId !== null) ||
        (mail && origin.kind === 'effect' && delivery !== 'gmail_verified') ||
        (mail && origin.kind === 'user') ||
        (mail && origin.kind === 'gmail' && (mail.accountRef !== origin.accountRef || mail.gmailId !== origin.gmailId))) throw new Error('INVALID_CRM_RESPONSE');
    return {delivery, mail, observationId};
}

export interface CrmResolution {
    accountRef: string;
    gmailId: string;
    address: string | null;
    reason: 'header_review_required' | 'invalid_address' | 'reply_to_mismatch' | 'new_sender' | 'ambiguous' | 'exact_unique';
    candidates: {
        id: string;
        name: string;
    }[];
    link: {
        contactId: string | null;
        automatic: boolean;
    } | null;
    revision: number;
    direction: 'incoming' | 'outgoing';
}
export function parseCrmResolution(raw: unknown, tenant: string, accountRef: string, gmailId: string): CrmResolution {
    const root = crmRecord(raw), v = crmRecord(root.resolution);
    if (root.tenantId !== tenant || v.accountRef !== accountRef || v.gmailId !== gmailId)
        throw new Error('INVALID_CRM_RESPONSE');
    const l = v.link === null ? null : crmRecord(v.link);
    return { accountRef, gmailId, address: v.address === null ? null : normalizeCrmEmail(v.address), reason: crmEnum(v.reason, ['header_review_required', 'invalid_address', 'reply_to_mismatch', 'new_sender', 'ambiguous', 'exact_unique']), candidates: rows(v.candidates, 5000).map(c => ({ id: crmId(c.id), name: crmText(c.name, 200) })), link: l ? { contactId: l.contactId === null ? null : crmId(l.contactId), automatic: bool(l.automatic) } : null, revision: crmRevision(v.revision), direction: crmEnum(v.direction, ['incoming', 'outgoing']) };
}
