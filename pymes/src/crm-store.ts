import { createHash } from 'node:crypto';
import { CrmError, parseCrmCommand, crmId, crmRevision, crmTime, normalizeCrmEmail, crmText, type CrmSource, type CrmContact, type CrmIdentity, type CrmLead, type CrmInteraction, type CrmFollowUp, type CrmLink, type CrmAudit, type CrmView, type CrmCommandInput } from './crm-contract.js';
type InternalOperation = {
    type: 'mail.link';
    accountRef: string;
    gmailId: string;
    contactId: string;
    automatic: boolean;
    direction: 'incoming' | 'outgoing';
    summary: string;
} | {
    type: 'workflow.prepare';
    taskId: string;
    contactId: string;
    recipient: string;
    title: string;
    line?:import('./crm-contract.js').CrmLine;
    recipientReviewed?:true;
    createLead?:boolean;
    followUpTitle?:string;
    followUpDueAt?:number;
} | {
    type: 'workflow.effect';
    taskId: string;
    effectId: string;
    state: 'unknown' | 'committed' | 'failed';
};
export type StoreCrmCommand = Omit<CrmCommandInput, 'operation'> & {
    tenant: string;
    owner: string;
    at: number;
    source: CrmSource;
    operation: CrmCommandInput['operation'] | InternalOperation;
};
interface State {
    revision: number;
    contacts: Record<string, CrmContact>;
    identities: Record<string, CrmIdentity>;
    leads: Record<string, CrmLead>;
    interactions: Record<string, CrmInteraction>;
    followUps: Record<string, CrmFollowUp>;
    links: Record<string, CrmLink>;
    audit: CrmAudit[];
    workflows: Record<string, {
        contactId: string;
        leadId: string|null;
        followUpTitle?:string;
        followUpDueAt?:number;
    }>;
    commands: Record<string, {
        hash: string;
        result: CrmResult;
    }>;
}
export interface CrmResult {
    revision: number;
    contactId: string | null;
    recordId: string | null;
}
const fresh = (): State => ({ revision: 0, contacts: {}, identities: {}, leads: {}, interactions: {}, followUps: {}, links: {}, audit: [], workflows: {}, commands: {} });
const hashed = (...parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const own = <T>(map: Record<string, T>, key: string): T | undefined => Object.hasOwn(map, key) ? map[key] : undefined;
/** Deterministic product projection registered in JournalKernel. Mutations stage a copy
 * before publication; validation failures never alter the in-memory projection. */
export class CrmStore {
    private states = new Map<string, State>();
    constructor(private readonly tenant: string) { crmId(tenant); }
    private get(owner: string) { crmId(owner); return this.states.get(owner) ?? fresh(); }
    revision(owner: string) { return this.get(owner).revision; }
    contact(owner: string, id: string) { const v = own(this.get(owner).contacts, id); return v ? structuredClone(v) : null; }
    workflow(owner: string, taskId: string) { const v = own(this.get(owner).workflows, taskId); return v ? structuredClone(v) : null; }
    link(owner: string, accountRef: string, gmailId: string) { return structuredClone(own(this.get(owner).links, hashed(accountRef, gmailId)) ?? null); }
    match(owner: string, email: string): CrmContact[] { const s = this.get(owner), e = normalizeCrmEmail(email), ids = new Set(Object.values(s.identities).filter(i => i.active && i.email === e).map(i => i.contactId)); return [...ids].map(id => s.contacts[id]!).filter(c => c.status === 'active').map(c => structuredClone(c)); }
    view(owner: string, input: {
        query?: string;
        contactId?: string | null;
        taskStatus?: 'pending' | 'done' | 'cancelled' | 'all';
    } = {}, now = Date.now()): CrmView {
        const s = this.get(owner), query = (input.query ?? '').toLocaleLowerCase('es'), id = input.contactId ?? null;
        if (id && !own(s.contacts, id))
            throw new CrmError('CRM_CONTACT_NOT_FOUND');
        const emailFor = (id: string) => Object.values(s.identities).filter(i => i.contactId === id && i.active).map(i => i.email).join(' ');
        const contacts = Object.values(s.contacts).filter(c => !query || (c.name + ' ' + c.phone + ' ' + emailFor(c.id)).toLocaleLowerCase('es').includes(query)).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
        const allFollowUps = Object.values(s.followUps).filter(v => (!id || v.contactId === id) && (!input.taskStatus || input.taskStatus === 'all' || v.status === input.taskStatus)).sort((a, b) => a.dueAt - b.dueAt || a.id.localeCompare(b.id));
        const forContact = <T extends {
            contactId: string;
        }>(values: T[]) => id ? values.filter(v => v.contactId === id) : [];
        const pending = Object.values(s.followUps).filter(v => v.status === 'pending');
        return structuredClone({ revision: s.revision, contacts: id && !query && !contacts.slice(0, 200).some(c => c.id === id) ? [...contacts.slice(0, 199), s.contacts[id]!] : contacts.slice(0, 200), totalContacts: contacts.length, contactsTruncated: contacts.length > 200, selectedContactId: id,
            identities: forContact(Object.values(s.identities)).slice(0, 100), leads: forContact(Object.values(s.leads)).slice(-100), interactions: forContact(Object.values(s.interactions)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 100), followUps: allFollowUps.slice(0, 100), followUpsTotal: allFollowUps.length, followUpsTruncated: allFollowUps.length > 100, links: forContact(Object.values(s.links).filter((l): l is CrmLink & {
                contactId: string;
            } => !!l.contactId)).slice(-100), audit: s.audit.filter(a => id ? a.contactId === id : true).slice(-50).reverse(), counts: { contacts: Object.values(s.contacts).filter(c => c.status === 'active').length, leads: Object.values(s.leads).filter(l => !['won', 'lost'].includes(l.status)).length, pending: pending.length, overdue: pending.filter(v => v.dueAt < now).length } });
    }
    apply(raw: StoreCrmCommand): CrmResult {
        if (raw.tenant !== this.tenant)
            throw new CrmError('CRM_SCOPE_DENIED');
        crmId(raw.owner);
        crmId(raw.commandId);
        crmRevision(raw.expectedRevision);
        crmTime(raw.at);
        const internal = ['mail.link', 'workflow.prepare', 'workflow.effect'].includes(raw.operation.type);
        const op = internal ? raw.operation : parseCrmCommand({ commandId: raw.commandId, expectedRevision: raw.expectedRevision, operation: raw.operation }).operation;
        const current = this.get(raw.owner), { at: _, expectedRevision: __, ...identity } = raw, hash = createHash('sha256').update(JSON.stringify({ ...identity, operation: op })).digest('hex'), previous = own(current.commands, raw.commandId);
        if (previous) {
            if (previous.hash !== hash)
                throw new CrmError('CRM_COMMAND_CONFLICT');
            return structuredClone(previous.result);
        }
        if (current.revision !== raw.expectedRevision)
            throw new CrmError('CRM_REVISION_CONFLICT');
        const s = structuredClone(current), at = raw.at, source = structuredClone(raw.source);
        let contactId: string | null = null, recordId: string | null = null;
        const contact = (id: string, active = true) => {
            const c = own(s.contacts, id);
            if (!c)
                throw new CrmError('CRM_CONTACT_NOT_FOUND');
            if (active && c.status !== 'active')
                throw new CrmError('CRM_CONTACT_ARCHIVED');
            contactId = id;
            return c;
        };
        const unique = <T>(map: Record<string, T>, id: string) => {
            crmId(id);
            if (own(map, id))
                throw new CrmError('CRM_RECORD_EXISTS');
            recordId = id;
        };
        const newLead = (id: string, cid: string, title: string, line: CrmLead['line']) => { unique(s.leads, id); s.leads[id] = { id, contactId: cid, title, line, status: 'new', createdAt: at, updatedAt: at, source }; };
        switch (op.type) {
            case 'contact.create':
                unique(s.contacts, op.id);
                contactId = op.id;
                s.contacts[op.id] = { id: op.id, name: op.name, phone: op.phone, notes: op.notes, relationship: op.relationship, status: 'active', createdAt: at, updatedAt: at, version: 1, source };
                if (op.email) {
                    const id = hashed('identity', op.id, op.email);
                    s.identities[id] = { id, contactId: op.id, email: op.email, active: true, verified: false, source, createdAt: at };
                }
                break;
            case 'contact.update': {
                const c = contact(op.id, false);
                Object.assign(c, { name: op.name, phone: op.phone, notes: op.notes, relationship: op.relationship, status: op.status, updatedAt: at, version: c.version + 1 });
                recordId = op.id;
                break;
            }
            case 'identity.add':
                contact(op.contactId);
                unique(s.identities, op.id);
                if (Object.values(s.identities).some(i => i.contactId === op.contactId && i.active && i.email === op.email))
                    throw new CrmError('CRM_IDENTITY_EXISTS');
                s.identities[op.id] = { id: op.id, contactId: op.contactId, email: op.email, active: true, verified: false, createdAt: at, source };
                break;
            case 'identity.remove': {
                const i = own(s.identities, op.id);
                if (!i)
                    throw new CrmError('CRM_IDENTITY_NOT_FOUND');
                contact(i.contactId, false);
                i.active = false;
                recordId = op.id;
                break;
            }
            case 'lead.create':
                contact(op.contactId);
                newLead(op.id, op.contactId, op.title, op.line);
                break;
            case 'lead.update': {
                const l = own(s.leads, op.id);
                if (!l)
                    throw new CrmError('CRM_LEAD_NOT_FOUND');
                contact(l.contactId);
                l.status = op.status;
                l.updatedAt = at;
                recordId = op.id;
                break;
            }
            case 'followup.create':
                contact(op.contactId);
                unique(s.followUps, op.id);
                if (op.leadId && own(s.leads, op.leadId)?.contactId !== op.contactId)
                    throw new CrmError('CRM_LEAD_NOT_FOUND');
                s.followUps[op.id] = { id: op.id, contactId: op.contactId, leadId: op.leadId, title: op.title, dueAt: op.dueAt, status: 'pending', createdAt: at, updatedAt: at, source };
                break;
            case 'followup.update': {
                const f = own(s.followUps, op.id);
                if (!f)
                    throw new CrmError('CRM_FOLLOWUP_NOT_FOUND');
                contact(f.contactId, false);
                f.status = op.status;
                f.updatedAt = at;
                recordId = op.id;
                break;
            }
            case 'interaction.note':
                contact(op.contactId);
                unique(s.interactions, op.id);
                s.interactions[op.id] = { id: op.id, contactId: op.contactId, summary: op.summary, direction: 'note', state: 'note', createdAt: at, updatedAt: at, source };
                break;
            case 'mail.link': {
                contact(op.contactId);
                const key = hashed(op.accountRef, op.gmailId), old = own(s.links, key);
                if (old?.contactId && old.contactId !== op.contactId)
                    throw new CrmError('CRM_MAIL_ALREADY_LINKED');
                if (old?.contactId === op.contactId) {
                    recordId = old.interactionId;
                    break;
                }
                const id = hashed('mail', raw.commandId);
                s.links[key] = { accountRef: op.accountRef, gmailId: op.gmailId, contactId: op.contactId, interactionId: id, updatedAt: at, automatic: op.automatic };
                s.interactions[id] = { id, contactId: op.contactId, direction: op.direction, state: op.direction === 'incoming' ? 'received' : 'committed', summary: crmText(op.summary, 500), createdAt: at, updatedAt: at, source };
                recordId = id;
                break;
            }
            case 'mail.unlink': {
                const l = own(s.links, hashed(op.accountRef, op.gmailId));
                if (!l?.contactId)
                    throw new CrmError('CRM_MAIL_NOT_LINKED');
                contact(l.contactId, false);
                l.contactId = null;
                l.interactionId = null;
                l.updatedAt = at;
                break;
            }
            case 'workflow.prepare': {
                contact(op.contactId);
                const matches = this.match(raw.owner, op.recipient);
                if (op.recipientReviewed? !matches.some(c=>c.id===op.contactId): matches.length !== 1 || matches[0]!.id !== op.contactId)
                    throw new CrmError('CRM_RECIPIENT_REVIEW_REQUIRED');
                const old = own(s.workflows, op.taskId);
                if (old && old.contactId !== op.contactId)
                    throw new CrmError('CRM_WORKFLOW_CONTACT_CONFLICT');
                if (old) {
                    recordId = old.leadId;
                    break;
                }
                const id = hashed('workflow-lead', op.taskId);
                if(op.createLead!==false)newLead(id, op.contactId, crmText(op.title, 300), op.line??'other');
                s.workflows[op.taskId] = { contactId: op.contactId, leadId: op.createLead===false?null:id,...(op.followUpTitle?{followUpTitle:crmText(op.followUpTitle,300)}:{}),...(op.followUpDueAt!==undefined?{followUpDueAt:crmTime(op.followUpDueAt)}:{}) };
                recordId = s.workflows[op.taskId]!.leadId;
                break;
            }
            case 'workflow.effect': {
                const w = own(s.workflows, op.taskId);
                if (!w)
                    throw new CrmError('CRM_WORKFLOW_NOT_BOUND');
                contact(w.contactId, false);
                const id = hashed('effect', op.effectId), old = own(s.interactions, id);
                if (old && old.contactId !== w.contactId)
                    throw new CrmError('CRM_EFFECT_CONTACT_CONFLICT');
                if (old?.state === 'committed' && op.state !== 'committed')
                    throw new CrmError('CRM_EFFECT_STATE_REGRESSION');
                s.interactions[id] = { id, contactId: w.contactId, direction: 'outgoing', state: op.state, summary: 'Respuesta por correo · ' + (op.state === 'committed' ? 'envío confirmado' : op.state === 'unknown' ? 'resultado incierto' : 'envío fallido'), createdAt: old?.createdAt ?? at, updatedAt: at, source };
                recordId = id;
                if (op.state === 'committed') {
                    const fid = hashed('effect-followup', op.effectId);
                    if (!own(s.followUps, fid))
                        s.followUps[fid] = { id: fid, contactId: w.contactId, leadId: w.leadId, title: w.followUpTitle??'Revisar respuesta y próximos pasos', dueAt: w.followUpDueAt??at + 86400000, status: 'pending', createdAt: at, updatedAt: at, source };
                }
                break;
            }
        }
        if (Object.keys(s.contacts).length > 5000 || Object.keys(s.interactions).length > 50000 || Object.keys(s.followUps).length > 20000 || Object.keys(s.identities).length > 20000 || Object.keys(s.leads).length > 20000)
            throw new CrmError('CRM_CAPACITY_REACHED');
        s.revision++;
        const result = { revision: s.revision, contactId, recordId };
        s.audit.push({ commandId: raw.commandId, operation: op.type, contactId, at, source, revision: s.revision });
        s.commands[raw.commandId] = { hash, result };
        this.states.set(raw.owner, s);
        return structuredClone(result);
    }
}
