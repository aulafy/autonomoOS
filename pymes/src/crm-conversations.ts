import type { CrmInteraction, CrmMailTrace } from './crm-contract.js';
export const crmDeliveryLabels: Record<CrmMailTrace['delivery'], string> = {
    gmail_verified: 'Gmail · envío verificado', gmail_unverified: 'Gmail · sin evidencia de envío confirmado',
    simulation: 'Simulación · no acredita un envío real', unclassified: 'Proveedor histórico sin acreditar',
    gmail_imported: 'Correo sincronizado de Gmail', note: 'Nota del profesional',
};
/** Keep historical text in provenance, but do not present a simulated/legacy
 * committed record as an externally verified send. */
export function crmInteractionDisplay(i: CrmInteraction): {status: string; summary: string} {
    const labels = {received: 'Recibido', committed: 'Envío confirmado', unknown: 'Resultado incierto', failed: 'Fallido', note: 'Nota'};
    if (i.state !== 'committed') return {status: labels[i.state], summary: i.summary};
    const delivery = i.trace?.delivery ?? (i.source.kind === 'gmail' ? 'gmail_imported' : 'unclassified');
    if (delivery === 'simulation') return {status: 'Simulación completada', summary: 'Prueba local del envío. No acredita un correo enviado mediante Gmail.'};
    if (delivery === 'unclassified' || delivery === 'gmail_unverified') return {status: 'Registro pendiente de acreditar', summary: 'El historial registra un resultado confirmado, pero no hay evidencia suficiente para acreditar aquí un envío real.'};
    return {status: delivery === 'gmail_imported' ? 'Correo en Enviados' : labels[i.state], summary: i.summary};
}
export interface CrmConversationEntry { primary: CrmInteraction; records: CrmInteraction[]; }
export interface CrmConversation { key: string; threaded: boolean; entries: CrmConversationEntry[]; updatedAt: number; }
/** Presentation only: combine a synced copy with one uniquely proved send.
 * Neither matching content/subject/Message-ID nor an UNKNOWN can combine records.
 * All records remain available in the entry; no mutation of the CRM projection. */
export function crmConversations(interactions: readonly CrmInteraction[]): CrmConversation[] {
    const mailKey = (i: CrmInteraction) => i.trace?.mail ? JSON.stringify([i.contactId, i.trace.mail.accountRef, i.trace.mail.gmailId]) : null;
    const proved = new Map<string, CrmInteraction[]>();
    for (const i of interactions) if (i.source.kind === 'effect' && i.state === 'committed' && i.trace?.delivery === 'gmail_verified') {
        const key = mailKey(i); if (key) proved.set(key, [...(proved.get(key) ?? []), i]);
    }
    const copies = new Map<string, CrmInteraction[]>(), combined = new Set<string>();
    for (const i of interactions) if (i.source.kind === 'gmail' && i.direction === 'outgoing' && i.state === 'committed' && i.trace?.delivery === 'gmail_imported') {
        const key = mailKey(i), matches = key && proved.get(key);
        if (matches && matches.length === 1 && matches[0]!.trace!.mail!.threadId === i.trace.mail?.threadId) {
            const id = matches[0]!.id; copies.set(id, [...(copies.get(id) ?? []), i]); combined.add(i.id);
        }
    }
    const groups = new Map<string, CrmConversation>();
    for (const i of interactions) {
        if (combined.has(i.id)) continue;
        const m = i.trace?.mail;
        const key = m ? JSON.stringify(['gmail', i.contactId, m.accountRef, m.threadId]) : JSON.stringify(['record', i.id]);
        let g = groups.get(key);
        if (!g) { g = {key, threaded: !!m, entries: [], updatedAt: i.updatedAt}; groups.set(key, g); }
        const records = [i, ...(copies.get(i.id) ?? [])];
        g.entries.push({primary: i, records}); g.updatedAt = Math.max(g.updatedAt, ...records.map(r => r.updatedAt));
    }
    return [...groups.values()].sort((a,b) => b.updatedAt - a.updatedAt || a.key.localeCompare(b.key)).map(g => ({...g, entries: g.entries.sort((a,b) => a.primary.createdAt - b.primary.createdAt || a.primary.id.localeCompare(b.primary.id))}));
}
