import type { InboxStatusView } from './inbox-service.js';
import type { MessageSummary, StoredMessage } from './inbox-store.js';
export type InboxContextTag = {
    accountRef: string | null;
    revision: number;
    tag: string;
};
export type GmailInboxPage = {
    items: MessageSummary[];
    nextCursor: string | null;
    context: InboxContextTag;
};
export type GmailInboxDetail = StoredMessage & {
    scopeState: 'active' | 'archived';
    attachments: {
        partId: string;
        filename: string;
        mimeType: string;
        size: number;
    }[];
};
const invalid = () => new Error('INVALID_GMAIL_INBOX_RESPONSE');
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v))
    throw invalid(); return v as Record<string, unknown>; }
function str(v: unknown, max: number): string { if (typeof v !== 'string' || v.length > max)
    throw invalid(); return v; }
function nullable(v: unknown, max: number): string | null { return v === null ? null : str(v, max); }
function bool(v: unknown): boolean { if (typeof v !== 'boolean')
    throw invalid(); return v; }
function num(v: unknown, max = 8640000000000000): number { if (!Number.isSafeInteger(v) || Number(v) < 0 || Number(v) > max)
    throw invalid(); return Number(v); }
function time(v: unknown): number | null { return v === null ? null : num(v); }
function enumeration<T extends string>(v: unknown, allowed: readonly T[]): T { if (!allowed.includes(v as T))
    throw invalid(); return v as T; }
function array(v: unknown, max: number): unknown[] { if (!Array.isArray(v) || v.length > max)
    throw invalid(); return v; }
function id(v: unknown): string { const s = str(v, 100); if (!/^[-a-zA-Z0-9_]{1,100}$/.test(s))
    throw invalid(); return s; }
function ref(v: unknown): string { const s = str(v, 32); if (!/^[a-f0-9]{32}$/.test(s))
    throw invalid(); return s; }
function labels(v: unknown): string[] { return array(v, 1000).map(x => str(x, 100)); }
function tenant(v: Record<string, unknown>, expected: string) { if (v.tenantId !== expected)
    throw invalid(); }
export function parseInboxContext(raw: unknown): InboxContextTag { const v = object(raw); const tag = str(v.tag, 24); if (!/^[a-f0-9]{24}$/.test(tag))
    throw invalid(); return { accountRef: v.accountRef === null ? null : ref(v.accountRef), revision: num(v.revision, Number.MAX_SAFE_INTEGER), tag }; }
export function sameInboxContext(a: InboxContextTag, b: InboxContextTag): boolean { return a.tag === b.tag && a.accountRef === b.accountRef && a.revision === b.revision; }
export function parseGmailInboxStatus(raw: unknown, expected: string): InboxStatusView {
    const v = object(raw);
    tenant(v, expected);
    const account = (raw: unknown) => { const a = object(raw); return { accountRef: ref(a.accountRef), email: str(a.email, 254), active: bool(a.active) }; };
    const accounts = array(v.accounts, 100).map(raw => { const a = object(raw); return { ...account(a), messageCount: num(a.messageCount, Number.MAX_SAFE_INTEGER) }; });
    if (new Set(accounts.map(a => a.accountRef)).size !== accounts.length)
        throw invalid();
    const current = v.account === null ? null : account(v.account), context = parseInboxContext(v.context), w = object(v.window);
    if (current?.accountRef !== context.accountRef && !(current === null && context.accountRef === null))
        throw invalid();
    if (current && !accounts.some(a => a.accountRef === current.accountRef))
        throw invalid();
    return { state: enumeration(v.state, ['never', 'importing', 'resync', 'catching_up', 'up_to_date', 'paused_after_purge', 'disconnected', 'needs_reconnect', 'limit', 'waiting_retry', 'error']), account: current, accounts,
        connected: bool(v.connected), running: bool(v.running), truncated: bool(v.truncated), catchupPending: bool(v.catchupPending), resyncRequired: bool(v.resyncRequired), autoSyncPaused: bool(v.autoSyncPaused),
        lastSyncAt: time(v.lastSyncAt), nextSyncAt: time(v.nextSyncAt), errorCode: nullable(v.errorCode, 120), errorCategory: v.errorCategory === null ? null : enumeration(v.errorCategory, ['auth', 'limit', 'budget', 'backoff', 'busy', 'data'] as const),
        messageCount: num(v.messageCount, Number.MAX_SAFE_INTEGER), window: { days: num(w.days, 365), cap: num(w.cap, 20000) }, context };
}
function summary(raw: unknown): MessageSummary {
    const v = object(raw);
    return { gmailId: id(v.gmailId), threadId: v.threadId === null ? null : id(v.threadId), internalDate: time(v.internalDate), labels: labels(v.labels), from: nullable(v.from, 2000), to: nullable(v.to, 2000), subject: nullable(v.subject, 2000), snippet: nullable(v.snippet, 500), scopeState: enumeration(v.scopeState, ['active', 'archived']), bodySource: enumeration(v.bodySource, ['plain', 'html', 'none', 'too_large']), attachmentCount: num(v.attachmentCount, 100) };
}
export function parseGmailInboxPage(raw: unknown, expected: string): GmailInboxPage {
    const v = object(raw);
    tenant(v, expected);
    const items = array(v.items, 50).map(summary), context = parseInboxContext(v.context);
    if (items.length && context.accountRef === null || new Set(items.map(m => m.gmailId)).size !== items.length)
        throw invalid();
    return { items, nextCursor: nullable(v.nextCursor, 512), context };
}
export function parseGmailInboxDetail(raw: unknown, expected: string): {
    message: GmailInboxDetail;
    context: InboxContextTag;
} {
    const root = object(raw);
    tenant(root, expected);
    const v = object(root.message);
    const quality = v.quality === null ? null : object(v.quality);
    const m: GmailInboxDetail = { gmailId: id(v.gmailId), threadId: v.threadId === null ? null : id(v.threadId), internalDate: time(v.internalDate), labels: labels(v.labels),
        from: nullable(v.from, 2000), to: nullable(v.to, 2000), cc: nullable(v.cc, 2000), replyTo: nullable(v.replyTo, 2000), subject: nullable(v.subject, 2000), date: nullable(v.date, 2000), messageId: nullable(v.messageId, 2000), inReplyTo: nullable(v.inReplyTo, 2000), references: nullable(v.references, 2000), snippet: nullable(v.snippet, 500),
        bodyText: str(v.bodyText, 65536), bodySource: enumeration(v.bodySource, ['plain', 'html', 'none', 'too_large']), bodyTruncated: bool(v.bodyTruncated), sizeEstimate: time(v.sizeEstimate), firstSeenAt: num(v.firstSeenAt), updatedAt: num(v.updatedAt), scopeState: enumeration(v.scopeState, ['active', 'archived']),
        quality: quality === null ? null : { charsetFallback: bool(quality.charsetFallback), attachmentsTruncated: bool(quality.attachmentsTruncated), structureTruncated: bool(quality.structureTruncated), bodyUnavailable: bool(quality.bodyUnavailable) },
        attachments: array(v.attachments, 100).map(raw => { const a = object(raw); return { partId: str(a.partId, 100), filename: str(a.filename, 500), mimeType: str(a.mimeType, 200), size: num(a.size) }; }) };
    const context = parseInboxContext(root.context);
    if (!context.accountRef)
        throw invalid();
    return { message: m, context };
}
export type PurgeChallenge = {
    confirmationId: string;
    expiresAt: number;
    account: string;
    accountRef: string;
    messageCount: number;
};
export function parsePurgeChallenge(raw: unknown, expected: string): PurgeChallenge { const v = object(raw); tenant(v, expected); const confirmationId = str(v.confirmationId, 64); if (!/^[a-f0-9]{64}$/.test(confirmationId))
    throw invalid(); return { confirmationId, expiresAt: num(v.expiresAt), account: str(v.account, 254), accountRef: ref(v.accountRef), messageCount: num(v.messageCount, Number.MAX_SAFE_INTEGER) }; }
export function reconcileInboxSelection(items: readonly MessageSummary[], selectedId: string | null, authorized: boolean): string | null { return authorized && selectedId && items.some(m => m.gmailId === selectedId) ? selectedId : null; }
export function acceptInboxDetail(context: InboxContextTag | null, response: {
    context: InboxContextTag;
    message: {
        gmailId: string;
    };
}, items: readonly MessageSummary[], selectedId: string | null): boolean { return !!context && sameInboxContext(context, response.context) && response.message.gmailId === reconcileInboxSelection(items, selectedId, true); }
export function inboxDate(value: number | null, full = false): string { return value === null ? 'Sin fecha' : new Intl.DateTimeFormat('es-ES', full ? { dateStyle: 'medium', timeStyle: 'short' } : { day: 'numeric', month: 'short' }).format(new Date(value)); }
export function inboxStateLabel(s: InboxStatusView): string {
    if (s.running)
        return 'Sincronizando el correo…';
    const labels: Record<InboxStatusView['state'], string> = { never: s.connected ? 'Primera importación pendiente' : 'Conecta Gmail para empezar', importing: 'Importación en curso · continuará desde el último avance', resync: 'Revisando cambios y correos guardados', catching_up: 'Importación guardada · poniéndose al día', up_to_date: s.lastSyncAt === null ? 'Sincronización completada' : `Última actualización: ${inboxDate(s.lastSyncAt, true)}`, paused_after_purge: 'Datos borrados · sincronización automática pausada', disconnected: 'Correos guardados · cuenta desconectada', needs_reconnect: 'Gmail necesita autorización de nuevo', limit: 'La importación ha alcanzado el límite de candidatos', waiting_retry: 'Gmail no está disponible · reintento programado', error: 'No se ha completado la sincronización' };
    return labels[s.state];
}
