/** Product contracts shared by host and browser. Email matching is not identity verification. */
export const CRM_LINES = ['car', 'life', 'home', 'professional_liability', 'other'] as const;
export type CrmLine = typeof CRM_LINES[number];
export const CRM_LEAD_STATES = ['new', 'contacted', 'proposal', 'won', 'lost'] as const;
export type CrmLeadState = typeof CRM_LEAD_STATES[number];
export type CrmSource = {
    kind: 'user';
} | {
    kind: 'gmail';
    accountRef: string;
    gmailId: string;
} | {
    kind: 'effect';
    effectId: string;
    taskId: string;
};
export interface CrmContact {
    id: string;
    name: string;
    phone: string;
    notes: string;
    relationship: 'prospect' | 'client';
    status: 'active' | 'archived';
    createdAt: number;
    updatedAt: number;
    version: number;
    source: CrmSource;
}
export interface CrmIdentity {
    id: string;
    contactId: string;
    email: string;
    active: boolean;
    verified: false;
    source: CrmSource;
    createdAt: number;
}
export interface CrmLead {
    id: string;
    contactId: string;
    title: string;
    line: CrmLine;
    status: CrmLeadState;
    createdAt: number;
    updatedAt: number;
    source: CrmSource;
}
/** Read-only provenance, reconstructed from authoritative journal observations.
 * Missing provenance is legacy/unclassified, never evidence of a real send. */
export interface CrmMailTrace {
    delivery: 'gmail_verified' | 'gmail_unverified' | 'simulation' | 'unclassified' | 'gmail_imported' | 'note';
    mail: { accountRef: string; gmailId: string; threadId: string } | null;
    observationId: string | null;
}
export interface CrmInteraction {
    id: string;
    contactId: string;
    direction: 'incoming' | 'outgoing' | 'note';
    state: 'received' | 'committed' | 'unknown' | 'failed' | 'note';
    summary: string;
    trace?: CrmMailTrace;
    createdAt: number;
    updatedAt: number;
    source: CrmSource;
}
export interface CrmFollowUp {
    id: string;
    contactId: string;
    leadId: string | null;
    title: string;
    dueAt: number;
    status: 'pending' | 'done' | 'cancelled';
    createdAt: number;
    updatedAt: number;
    source: CrmSource;
}
export interface CrmLink {
    accountRef: string;
    gmailId: string;
    contactId: string | null;
    interactionId: string | null;
    updatedAt: number;
    automatic: boolean;
}
export interface CrmAudit {
    commandId: string;
    operation: string;
    contactId: string | null;
    at: number;
    source: CrmSource;
    revision: number;
}
export interface CrmView {
    revision: number;
    contacts: CrmContact[];
    totalContacts: number;
    contactsTruncated: boolean;
    selectedContactId: string | null;
    identities: CrmIdentity[];
    leads: CrmLead[];
    interactions: CrmInteraction[];
    followUps: CrmFollowUp[];
    followUpsTotal: number;
    followUpsTruncated: boolean;
    links: CrmLink[];
    audit: CrmAudit[];
    counts: {
        contacts: number;
        leads: number;
        pending: number;
        overdue: number;
    };
}
export type CrmOperation = {
    type: 'contact.create';
    id: string;
    name: string;
    email: string;
    phone: string;
    notes: string;
    relationship: 'prospect' | 'client';
} | {
    type: 'contact.update';
    id: string;
    name: string;
    phone: string;
    notes: string;
    relationship: 'prospect' | 'client';
    status: 'active' | 'archived';
} | {
    type: 'identity.add';
    id: string;
    contactId: string;
    email: string;
} | {
    type: 'identity.remove';
    id: string;
} | {
    type: 'lead.create';
    id: string;
    contactId: string;
    title: string;
    line: CrmLine;
} | {
    type: 'lead.update';
    id: string;
    status: CrmLeadState;
} | {
    type: 'followup.create';
    id: string;
    contactId: string;
    leadId: string | null;
    title: string;
    dueAt: number;
} | {
    type: 'followup.update';
    id: string;
    status: 'pending' | 'done' | 'cancelled';
} | {
    type: 'interaction.note';
    id: string;
    contactId: string;
    summary: string;
} | {
    type: 'mail.unlink';
    accountRef: string;
    gmailId: string;
};
export interface CrmCommandInput {
    commandId: string;
    expectedRevision: number;
    operation: CrmOperation;
}
export class CrmError extends Error {
}
export function crmId(value: unknown): string {
    if (typeof value !== 'string' || !/^[-a-zA-Z0-9_]{1,200}$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value))
        throw new CrmError('CRM_INVALID_INPUT');
    return value;
}
export function crmText(value: unknown, max: number, empty = false): string {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
        throw new CrmError('CRM_INVALID_INPUT');
    return value.trim();
}
export function normalizeCrmEmail(value: unknown, empty = false): string {
    const s = crmText(value, 254, empty).toLowerCase();
    if (!s && empty)
        return s;
    if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(s))
        throw new CrmError('CRM_INVALID_EMAIL');
    return s;
}
export function crmRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new CrmError('CRM_INVALID_INPUT');
    return value as Record<string, unknown>;
}
function keys(v: Record<string, unknown>, list: string[]) {
    if (Object.keys(v).sort().join(',') !== list.sort().join(','))
        throw new CrmError('CRM_INVALID_INPUT');
}
export function crmRevision(v: unknown): number {
    if (!Number.isSafeInteger(v) || Number(v) < 0)
        throw new CrmError('CRM_INVALID_INPUT');
    return Number(v);
}
export function crmTime(v: unknown): number {
    const n = crmRevision(v);
    if (n > 8640000000000000)
        throw new CrmError('CRM_INVALID_INPUT');
    return n;
}
export function crmEnum<T extends string>(v: unknown, allowed: readonly T[]): T {
    if (!allowed.includes(v as T))
        throw new CrmError('CRM_INVALID_INPUT');
    return v as T;
}
export function crmRef(v: unknown): string {
    if (typeof v !== 'string' || !/^([a-f0-9]{32})$/.test(v))
        throw new CrmError('CRM_INVALID_INPUT');
    return v;
}
export function parseCrmCommand(raw: unknown): CrmCommandInput {
    const root = crmRecord(raw);
    keys(root, ['commandId', 'expectedRevision', 'operation']);
    const op = crmRecord(root.operation);
    const t = op.type;
    let operation: CrmOperation;
    switch (t) {
        case 'contact.create':
            keys(op, ['type', 'id', 'name', 'email', 'phone', 'notes', 'relationship']);
            operation = { type: t, id: crmId(op.id), name: crmText(op.name, 200), email: normalizeCrmEmail(op.email, true), phone: crmText(op.phone, 100, true), notes: crmText(op.notes, 2000, true), relationship: crmEnum(op.relationship, ['prospect', 'client']) };
            break;
        case 'contact.update':
            keys(op, ['type', 'id', 'name', 'phone', 'notes', 'relationship', 'status']);
            operation = { type: t, id: crmId(op.id), name: crmText(op.name, 200), phone: crmText(op.phone, 100, true), notes: crmText(op.notes, 2000, true), relationship: crmEnum(op.relationship, ['prospect', 'client']), status: crmEnum(op.status, ['active', 'archived']) };
            break;
        case 'identity.add':
            keys(op, ['type', 'id', 'contactId', 'email']);
            operation = { type: t, id: crmId(op.id), contactId: crmId(op.contactId), email: normalizeCrmEmail(op.email) };
            break;
        case 'identity.remove':
            keys(op, ['type', 'id']);
            operation = { type: t, id: crmId(op.id) };
            break;
        case 'lead.create':
            keys(op, ['type', 'id', 'contactId', 'title', 'line']);
            operation = { type: t, id: crmId(op.id), contactId: crmId(op.contactId), title: crmText(op.title, 300), line: crmEnum(op.line, CRM_LINES) };
            break;
        case 'lead.update':
            keys(op, ['type', 'id', 'status']);
            operation = { type: t, id: crmId(op.id), status: crmEnum(op.status, CRM_LEAD_STATES) };
            break;
        case 'followup.create':
            keys(op, ['type', 'id', 'contactId', 'leadId', 'title', 'dueAt']);
            operation = { type: t, id: crmId(op.id), contactId: crmId(op.contactId), leadId: op.leadId === null ? null : crmId(op.leadId), title: crmText(op.title, 300), dueAt: crmTime(op.dueAt) };
            break;
        case 'followup.update':
            keys(op, ['type', 'id', 'status']);
            operation = { type: t, id: crmId(op.id), status: crmEnum(op.status, ['pending', 'done', 'cancelled']) };
            break;
        case 'interaction.note':
            keys(op, ['type', 'id', 'contactId', 'summary']);
            operation = { type: t, id: crmId(op.id), contactId: crmId(op.contactId), summary: crmText(op.summary, 2000) };
            break;
        case 'mail.unlink':
            keys(op, ['type', 'accountRef', 'gmailId']);
            operation = { type: t, accountRef: crmRef(op.accountRef), gmailId: crmId(op.gmailId) };
            break;
        default: throw new CrmError('CRM_INVALID_INPUT');
    }
    return { commandId: crmId(root.commandId), expectedRevision: crmRevision(root.expectedRevision), operation };
}
