import { createHash } from 'node:crypto';
import type { JournalKernel } from '@agent-world/runtime-store-sqlite';
import { CrmStore, type StoreCrmCommand } from './crm-store.js';
import { CrmError, crmId, crmRef, crmRevision, crmText, normalizeCrmEmail, parseCrmCommand, type CrmCommandInput, type CrmSource } from './crm-contract.js';
import { contextOf, type InboxService } from './inbox-service.js';
const hashed = (...parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
/** Exactly one address, no comments, groups or heuristic alias merging. */
export function crmMailbox(header: string | null): string | null {
    if (!header || header.length > 2000 || /[\r\n,;()]/.test(header))
        return null;
    const bracket = header.match(/^(?:[^<>]*)<([^<>]+)>\s*$/), value = bracket ? bracket[1]! : header;
    try {
        return normalizeCrmEmail(value);
    }
    catch {
        return null;
    }
}
export class CrmService {
    private closed = false;
    close() { this.closed = true; }
    constructor(readonly store: CrmStore, private journal: JournalKernel, readonly tenant: string, private inbox?: InboxService, private now: () => number = Date.now) { }
    private ready(tenant: string) {
        if (tenant !== this.tenant)
            throw new CrmError('CRM_SCOPE_DENIED');
        if (this.closed || !this.journal.isHealthy())
            throw new CrmError('CRM_NOT_READY');
    }
    view(tenant: string, owner: string, query: string, contactId: string | null, taskStatus: 'pending' | 'done' | 'cancelled' | 'all') { this.ready(tenant); return this.store.view(owner, { query, contactId, taskStatus }, this.now()); }
    command(tenant: string, owner: string, input: CrmCommandInput) { this.ready(tenant); const validated = parseCrmCommand(input); return this.store.apply({ ...validated, tenant, owner, at: this.now(), source: { kind: 'user' } }); }
    private internal(owner: string, commandId: string, operation: StoreCrmCommand['operation'], source: CrmSource) { this.ready(this.tenant); return this.store.apply({ tenant: this.tenant, owner, commandId, expectedRevision: this.store.revision(owner), operation, source, at: this.now() }); }
    private async mail(owner: string, accountRef: string, gmailId: string, live: () => boolean) {
        crmRef(accountRef);
        crmId(gmailId);
        if (!this.inbox || owner !== this.inbox.owner)
            throw new CrmError('CRM_INBOX_NOT_AVAILABLE');
        const ctx = await this.inbox.context(accountRef);
        if (!live())
            throw new CrmError('CRM_AUTH_CHANGED');
        if (!ctx.info || !ctx.readable)
            throw new CrmError('CRM_MAIL_NOT_AVAILABLE');
        const m = this.inbox.store.messageDetail(ctx.info.ns, gmailId);
        if (!m)
            throw new CrmError('CRM_MAIL_NOT_AVAILABLE');
        const fresh = await this.inbox.context(accountRef);
        if (!live())
            throw new CrmError('CRM_AUTH_CHANGED');
        if (JSON.stringify(contextOf(ctx)) !== JSON.stringify(contextOf(fresh)) || !fresh.readable)
            throw new CrmError('CRM_MAIL_CHANGED');
        const direction = m.labels.includes('SENT') ? 'outgoing' as const : 'incoming' as const;
        const address = crmMailbox(direction === 'outgoing' ? m.to : m.from), reply = crmMailbox(m.replyTo);
        const replyMismatch = direction === 'incoming' && !!m.replyTo && (!reply || reply !== address);
        const matches = address ? this.store.match(owner, address) : [];
        const reason = m.quality?.addressAmbiguous !== false ? 'header_review_required' : !address ? 'invalid_address' : replyMismatch ? 'reply_to_mismatch' : matches.length === 0 ? 'new_sender' : matches.length > 1 ? 'ambiguous' : 'exact_unique';
        return { m, direction, address, matches, reason, accountRef, gmailId };
    }
    async resolve(tenant: string, owner: string, input: {
        accountRef: string;
        gmailId: string;
    }, live: () => boolean) {
        this.ready(tenant);
        const m = await this.mail(owner, input.accountRef, input.gmailId, live);
        // D4: an exact unique match may be linked; a deliberately undone link stays undone.
        if (m.reason === 'exact_unique' && !this.store.link(owner, m.accountRef, m.gmailId))
            this.internal(owner, hashed('auto-link', m.accountRef, m.gmailId, m.matches[0]!.id), { type: 'mail.link', accountRef: m.accountRef, gmailId: m.gmailId, contactId: m.matches[0]!.id, automatic: true, direction: m.direction, summary: (m.m.subject ?? 'Correo sin asunto').slice(0, 500) }, { kind: 'gmail', accountRef: m.accountRef, gmailId: m.gmailId });
        return { accountRef: m.accountRef, gmailId: m.gmailId, address: m.address, reason: m.reason, candidates: m.matches.map(c => ({ id: c.id, name: c.name })), link: this.store.link(owner, m.accountRef, m.gmailId), revision: this.store.revision(owner), direction: m.direction };
    }
    async link(tenant: string, owner: string, input: {
        commandId: string;
        expectedRevision: number;
        accountRef: string;
        gmailId: string;
        contactId: string | null;
        reviewed: boolean;
    }, live: () => boolean) {
        this.ready(tenant);
        crmId(input.commandId);
        crmRevision(input.expectedRevision);
        const m = await this.mail(owner, input.accountRef, input.gmailId, live);
        const automatic = input.contactId === null;
        if (automatic && m.reason !== 'exact_unique')
            throw new CrmError('CRM_HUMAN_REVIEW_REQUIRED');
        if (!automatic && !input.reviewed)
            throw new CrmError('CRM_HUMAN_REVIEW_REQUIRED');
        const cid = automatic ? m.matches[0]!.id : crmId(input.contactId);
        return this.store.apply({ tenant, owner, commandId: input.commandId, expectedRevision: input.expectedRevision, at: this.now(), source: { kind: 'gmail', accountRef: m.accountRef, gmailId: m.gmailId }, operation: { type: 'mail.link', accountRef: m.accountRef, gmailId: m.gmailId, contactId: cid, automatic, direction: m.direction, summary: (m.m.subject ?? 'Correo sin asunto').slice(0, 500) } });
    }
    workflowAdapter(sourceFor?:(taskId:string)=>import('./mail-task-contract.js').MailTaskBinding|null) {
        return {
            prepare: (taskId: string, owner: string, payload: {
                contactId: string;
                to: string[];
            }, goal: string) => {
                if (!this.store.contact(owner, payload.contactId))
                    return null; // Legacy M2/M3 fixtures remain explicitly simulated.
                if (payload.to.length !== 1)
                    throw new CrmError('CRM_RECIPIENT_REVIEW_REQUIRED');
                const b=sourceFor?.(taskId);
                // A cancelled draft may never have reached CRM prepare. Reuse the
                // nearest prepared ancestor; otherwise this is the first lead.
                let prior=b?.revisesTaskId,prepared:string|undefined;
                for(let n=0;prior&&n<100;n++){
                    const ancestor=sourceFor?.(prior);
                    if(!ancestor||ancestor.owner!==owner||ancestor.contactId!==payload.contactId)throw new CrmError('CRM_REVISION_SCOPE_DENIED');
                    if(this.store.workflow(owner,prior)){prepared=prior;break;}
                    prior=ancestor.revisesTaskId;
                }
                const result = this.internal(owner, hashed('workflow-prepare', taskId), { type: 'workflow.prepare', taskId, contactId: payload.contactId, recipient: normalizeCrmEmail(payload.to[0]), title: goal.slice(0, 300) || 'Consulta por correo',...(b?{...(prepared?{revisesTaskId:prepared}:{}),line:b.line==='unknown'?'other':b.line,recipientReviewed:true as const,createLead:['quote','renewal'].includes(b.topic),followUpTitle:b.followUpTitle,followUpDueAt:b.followUpDueAt}:{}) }, b?{kind:'gmail',accountRef:b.accountRef,gmailId:b.gmailId}:{ kind: 'user' });
                return { contactId: payload.contactId, leadId: result.recordId };
            },
            effect: (taskId: string, owner: string, effect: {
                id: string;
                effective: string;
            }) => {
                if (!this.store.workflow(owner, taskId))
                    return null;
                const state = effect.effective === 'committed' ? 'committed' : effect.effective === 'unknown' ? 'unknown' : 'failed';
                return this.internal(owner, hashed('workflow-effect', taskId, effect.id, state), { type: 'workflow.effect', taskId, effectId: effect.id, state }, { kind: 'effect', effectId: effect.id, taskId });
            }
        };
    }
}
export type CrmWorkflowAdapter = ReturnType<CrmService['workflowAdapter']>;
