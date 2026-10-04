import type { CrmInteraction, CrmMailTrace } from './crm-contract.js';
import type { EmailReviewStore } from './email-review-store.js';
import type { MailTaskStore } from './mail-task-store.js';
import type { InboxStore } from './inbox-store.js';
import type { createDurableDomainStores } from '@agent-world/runtime-store-sqlite';
import { sameSubject } from '@agent-world/observation';
import { resolveEffectiveEffectOutcome } from '@agent-world/reconciliation';
import { emailHash, validateEmailPayload } from './email-provider.js';

/** No network, mutations or heuristics. Only evidence already admitted by C6/C12.
 * The namespace belongs to the original task, never the currently selected account. */
export function createCrmMailTrace(
    tenant: string, reviews: EmailReviewStore, tasks: MailTaskStore,
    domain: ReturnType<typeof createDurableDomainStores>, inbox?: InboxStore,
): (owner: string, interaction: CrmInteraction) => CrmMailTrace {
    return (owner, i) => {
        const plain = (delivery: CrmMailTrace['delivery']): CrmMailTrace => ({ delivery, mail: null, observationId: null });
        if (i.source.kind === 'user') return plain('note');
        if (i.source.kind === 'gmail') return plain('gmail_imported');
        const effect = domain.effects.get(i.source.effectId);
        if (!effect || effect.taskId !== i.source.taskId || effect.action !== 'email.send') return plain('unclassified');
        const review = reviews.reviewForIntent(owner, effect.taskId, effect.intentId);
        if (!review || review.payload.contactId !== i.contactId) return plain('unclassified');
        const b = tasks.task(effect.taskId);
        const decision = reviews.decision(review.id);
        if (!decision || decision.userId !== owner || decision.decision !== 'approved' || decision.bindingHash !== review.bindingHash) return plain('unclassified');
        try { if (emailHash(validateEmailPayload(effect.parameters)) !== review.payloadHash) return plain('unclassified'); }
        catch { return plain('unclassified'); }
        const decisions = domain.reconciliations.listDecisions(effect.id);
        const resolution = resolveEffectiveEffectOutcome(effect, decisions);
        const used = new Set(effect.status === 'unknown' ? decisions.filter(d => d.id === resolution.resolvedByDecisionId && d.outcome === 'confirmed_effect').flatMap(d => d.observationIds) : effect.observationIds);
        const observations = [...new Set([...effect.observationIds, ...used])].map(id => domain.observations.get(id)).filter(o => o &&
            o.source === 'provider' && o.observerId === 'email-mailbox-observer' && o.subject.effectId === effect.id &&
            sameSubject(o.subject, {taskId: effect.taskId, intentId: effect.intentId, executionId: effect.executionId, effectId: effect.id, resourceIds: effect.resourceIds}) &&
            o.expectedPostconditionHash === effect.expectedPostconditionHash);
        if (!review.provider && (b?.owner === owner && b.contactId === i.contactId && b.providerContext === 'fake-email' || effect.dispatchResult?.metadata?.provider === 'fake-email' || observations.some(o => o!.metadata.provider === 'fake-email' && o!.metadata.simulated === true))) return plain('simulation');
        if (review.provider !== 'gmail-email') return plain('unclassified');
        const trace = plain('gmail_unverified');
        if (i.state !== 'committed' || resolution.effectiveOutcome !== 'committed') return trace;
        const proofs = observations.filter(o => used.has(o!.id) && o!.status === 'confirmed' && o!.metadata.provider === 'gmail-email' && o!.metadata.simulated === false)
            .flatMap(o => o!.evidence.filter(e => e.kind === 'event' && e.metadata?.payloadHash === review.payloadHash && /^gmail:[a-zA-Z0-9_-]{1,200}$/.test(e.reference))
                .map(e => ({ gmailId: e.reference.slice(6), observationId: o!.id })));
        if (!proofs.length || new Set(proofs.map(p => p.gmailId)).size !== 1) return trace;
        trace.delivery = 'gmail_verified'; trace.observationId = proofs[0]!.observationId;
        const ns = b && inbox?.namespaceByRef(b.accountRef);
        if (b?.owner === owner && b.contactId === i.contactId && ns?.tenant === tenant && ns.owner === owner && ns.ns === b.ns && ns.account.toLowerCase() === review.payload.from.toLowerCase()) {
            // Local message/readability is checked by CrmService before exporting this pointer.
            trace.mail = { accountRef: b.accountRef, gmailId: proofs[0]!.gmailId, threadId: '' };
        }
        return trace;
    };
}
