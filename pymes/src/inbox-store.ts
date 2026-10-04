import {parseSavedMailProposal,type SavedMailProposal} from './mail-assistance-contract.js';
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type { ParsedInboxMessage } from "./inbox-mime.js";
/**
 * P03 — local, durable store for synchronised Gmail messages.
 *
 * Separate SQLite file (not the runtime journal): derived, re-synchronisable
 * data. Never stores OAuth tokens, client secrets or HTTP authorisation. No
 * logging of bodies. Writes are fenced by a lease so two syncers (same or
 * different process) cannot interleave on one namespace.
 */
export const INBOX_SCHEMA_VERSION = 4;
export type NamespaceSyncState = "never" | "in_progress" | "complete_window" | "complete_truncated" | "blocked";
export type RunPhase = "enumerate" | "select" | "fetch" | "done" | "abandoned";
export interface InboxNamespace {
    ns: string;
    tenant: string;
    owner: string;
    subject: string;
    account: string;
    /** Opaque Gmail historyId confirmed by a completed full sync (H0). */
    historyId: string | null;
    syncState: NamespaceSyncState;
    /** 1 after a full sync until P04's incremental catches up from historyId. */
    catchupPending: boolean;
    lastError: string | null;
    updatedAt: number;
}
export interface FullRun {
    runId: string;
    ns: string;
    startedAt: number;
    h0: string;
    windowStartMs: number;
    phase: RunPhase;
    candidates: number;
    selected: number;
    truncated: boolean;
    completedAt: number | null;
}
export interface StoredMessage {
    gmailId: string;
    threadId: string | null;
    internalDate: number | null;
    labels: string[];
    from: string | null;
    to: string | null;
    cc: string | null;
    replyTo: string | null;
    subject: string | null;
    date: string | null;
    messageId: string | null;
    inReplyTo: string | null;
    references: string | null;
    snippet: string | null;
    bodyText: string;
    bodySource: "plain" | "html" | "none" | "too_large";
    bodyTruncated: boolean;
    sizeEstimate: number | null;
    /** null for legacy rows whose parser quality was not persisted. */
    quality: {
        addressAmbiguous?: boolean;
        charsetFallback: boolean;
        attachmentsTruncated: boolean;
        structureTruncated: boolean;
        bodyUnavailable: boolean;
    } | null;
    firstSeenAt: number;
    updatedAt: number;
}
export interface MessageInput {
    gmailId: string;
    threadId: string | null;
    internalDate: number | null;
    labels: string[];
    snippet: string | null;
    sizeEstimate: number | null;
    parsed: ParsedInboxMessage;
    /** Response exceeded the full-format cap; headers only, no body. */
    tooLarge?: boolean;
}
export class InboxStoreError extends Error {
    constructor(code: string) {
        super(code);
        this.name = "InboxStoreError";
    }
}
export function inboxNamespace(tenant: string, owner: string, subject: string) {
    return createHash("sha256")
        .update(JSON.stringify({ type: "gmail-inbox-ns", tenant, owner, subject }))
        .digest("hex");
}
const SCHEMA = `
CREATE TABLE IF NOT EXISTS inbox_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inbox_namespace(
  ns TEXT PRIMARY KEY, tenant TEXT NOT NULL, owner TEXT NOT NULL, subject TEXT NOT NULL,
  account TEXT NOT NULL, history_id TEXT, sync_state TEXT NOT NULL, catchup_pending INTEGER NOT NULL,
  last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS inbox_full_run(
  run_id TEXT PRIMARY KEY, ns TEXT NOT NULL, started_at INTEGER NOT NULL, h0 TEXT NOT NULL,
  window_start_ms INTEGER NOT NULL, phase TEXT NOT NULL, candidates INTEGER NOT NULL DEFAULT 0,
  selected INTEGER NOT NULL DEFAULT 0, truncated INTEGER NOT NULL DEFAULT 0, completed_at INTEGER);
CREATE INDEX IF NOT EXISTS inbox_full_run_ns ON inbox_full_run(ns, phase);
CREATE TABLE IF NOT EXISTS inbox_candidate(
  run_id TEXT NOT NULL, gmail_id TEXT NOT NULL, internal_date INTEGER, minimal_done INTEGER NOT NULL DEFAULT 0,
  selected INTEGER NOT NULL DEFAULT 0, fetched INTEGER NOT NULL DEFAULT 0, outcome TEXT,
  PRIMARY KEY(run_id, gmail_id));
CREATE TABLE IF NOT EXISTS inbox_message(
  ns TEXT NOT NULL, gmail_id TEXT NOT NULL, thread_id TEXT, internal_date INTEGER, labels TEXT NOT NULL,
  from_h TEXT, to_h TEXT, cc_h TEXT, reply_to_h TEXT, subject_h TEXT, date_h TEXT, message_id_h TEXT,
  in_reply_to_h TEXT, references_h TEXT, snippet TEXT, body_text TEXT NOT NULL, body_source TEXT NOT NULL,
  body_truncated INTEGER NOT NULL, size_estimate INTEGER, deleted_at INTEGER,
  first_seen_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(ns, gmail_id));
CREATE INDEX IF NOT EXISTS inbox_message_date ON inbox_message(ns, internal_date DESC);
CREATE TABLE IF NOT EXISTS inbox_attachment(
  ns TEXT NOT NULL, gmail_id TEXT NOT NULL, part_id TEXT NOT NULL, filename TEXT NOT NULL,
  mime_type TEXT NOT NULL, size INTEGER NOT NULL, PRIMARY KEY(ns, gmail_id, part_id));
CREATE TABLE IF NOT EXISTS inbox_lease(ns TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL);
`;
export class InboxStore {
    private db: DatabaseSync;
    constructor(path: string, private now: () => number = Date.now) {
        if (path !== ":memory:")
            mkdirSync(dirname(path), { recursive: true });
        this.db = new DatabaseSync(path);
        try {
            if (path !== ":memory:") chmodSync(path, 0o600);
            this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;");
            this.tx(() => {
                this.db.exec(SCHEMA);
                const row = this.db.prepare("SELECT value FROM inbox_meta WHERE key='schema_version'").get() as {
                    value: string;
                } | undefined;
                if (!row)
                    this.db
                        .prepare("INSERT INTO inbox_meta VALUES('schema_version',?)")
                        .run(String(INBOX_SCHEMA_VERSION));
                else if (!/^[1-9][0-9]*$/.test(row.value) || !Number.isSafeInteger(Number(row.value)))
                    throw new InboxStoreError("INBOX_SCHEMA_INVALID");
                else if (Number(row.value) > INBOX_SCHEMA_VERSION)
                    throw new InboxStoreError("INBOX_SCHEMA_TOO_NEW");
                const columns = this.db.prepare("PRAGMA table_info(inbox_message)").all() as {
                    name: string;
                }[];
                if (!columns.some(c => c.name === "quality_json"))
                    this.db.exec("ALTER TABLE inbox_message ADD COLUMN quality_json TEXT");
                this.migrateV3();
                this.db.exec(`CREATE TABLE IF NOT EXISTS inbox_assistance(ns TEXT NOT NULL, gmail_id TEXT NOT NULL, proposal_json TEXT NOT NULL, PRIMARY KEY(ns,gmail_id));
CREATE TRIGGER IF NOT EXISTS inbox_assistance_updated AFTER UPDATE ON inbox_message BEGIN DELETE FROM inbox_assistance WHERE ns=NEW.ns AND gmail_id=NEW.gmail_id; END;
CREATE TRIGGER IF NOT EXISTS inbox_assistance_deleted AFTER DELETE ON inbox_message BEGIN DELETE FROM inbox_assistance WHERE ns=OLD.ns AND gmail_id=OLD.gmail_id; END;`);
                this.db.prepare("UPDATE inbox_meta SET value=? WHERE key='schema_version'").run(String(INBOX_SCHEMA_VERSION));
            });
        }
        catch (error) {
            this.db.close();
            throw error;
        }
    }
    assistance(ns: string, gmailId: string): SavedMailProposal|null {
        const row=this.db.prepare('SELECT proposal_json FROM inbox_assistance WHERE ns=? AND gmail_id=?').get(ns,gmailId) as {proposal_json:string}|undefined;
        if(!row)return null;
        try{return parseSavedMailProposal(JSON.parse(row.proposal_json));}catch{throw new InboxStoreError('MAIL_AI_STORED_INVALID');}
    }
    saveAssistance(ns:string,gmailId:string,expectedRevision:number,value:SavedMailProposal) {
        return this.tx(()=>{
            if(this.namespaceInfo(ns)?.revision!==expectedRevision||!this.messageDetail(ns,gmailId))throw new InboxStoreError('MAIL_AI_SOURCE_CHANGED');
            const validated=parseSavedMailProposal(value);
            this.db.prepare('INSERT INTO inbox_assistance VALUES(?,?,?) ON CONFLICT(ns,gmail_id) DO UPDATE SET proposal_json=excluded.proposal_json').run(ns,gmailId,JSON.stringify(validated));
            return validated;
        });
    }
    decideAssistance(ns:string,gmailId:string,proposalId:string,decision:'accepted'|'rejected') {
        return this.tx(()=>{
            const p=this.assistance(ns,gmailId);if(!p||p.id!==proposalId||!this.messageDetail(ns,gmailId))throw new InboxStoreError('MAIL_AI_PROPOSAL_CHANGED');
            if(p.state===decision)return p;
            if(p.state!=='proposed')throw new InboxStoreError('MAIL_AI_ALREADY_REVIEWED');
            const value={...p,state:decision,reviewedAt:this.now()};
            this.db.prepare('UPDATE inbox_assistance SET proposal_json=? WHERE ns=? AND gmail_id=?').run(JSON.stringify(value),ns,gmailId);return value;
        });
    }
    private tx<T>(fn: () => T): T {
        this.db.exec("BEGIN IMMEDIATE");
        try {
            const v = fn();
            this.db.exec("COMMIT");
            return v;
        }
        catch (e) {
            try {
                this.db.exec("ROLLBACK");
            }
            catch { }
            throw e;
        }
    }
    /** Fenced write: runs only if `token` still holds the namespace lease. */
    fenced<T>(ns: string, token: string, fn: () => T): T {
        return this.tx(() => {
            const lease = this.db.prepare("SELECT token, expires_at FROM inbox_lease WHERE ns=?").get(ns) as {
                token: string;
                expires_at: number;
            } | undefined;
            if (!lease || lease.token !== token || lease.expires_at < this.now())
                throw new InboxStoreError("INBOX_LEASE_LOST");
            return fn();
        });
    }
    acquireLease(ns: string, ttlMs: number): string | null {
        const token = randomBytes(16).toString("hex");
        return this.tx(() => {
            const lease = this.db.prepare("SELECT expires_at FROM inbox_lease WHERE ns=?").get(ns) as {
                expires_at: number;
            } | undefined;
            if (lease && lease.expires_at >= this.now())
                return null;
            this.db
                .prepare("INSERT INTO inbox_lease VALUES(?,?,?) ON CONFLICT(ns) DO UPDATE SET token=excluded.token, expires_at=excluded.expires_at")
                .run(ns, token, this.now() + ttlMs);
            return token;
        });
    }
    renewLease(ns: string, token: string, ttlMs: number) {
        this.fenced(ns, token, () => this.db.prepare("UPDATE inbox_lease SET expires_at=? WHERE ns=?").run(this.now() + ttlMs, ns));
    }
    releaseLease(ns: string, token: string) {
        this.tx(() => this.db.prepare("DELETE FROM inbox_lease WHERE ns=? AND token=?").run(ns, token));
    }
    ensureNamespace(tenant: string, owner: string, subject: string, account: string): InboxNamespace {
        const ns = inboxNamespace(tenant, owner, subject);
        this.tx(() => {
            const t = this.now();
            this.db
                .prepare("INSERT INTO inbox_namespace(ns,tenant,owner,subject,account,history_id,sync_state,catchup_pending,last_error,created_at,updated_at,account_ref) VALUES(?,?,?,?,?,NULL,'never',0,NULL,?,?,?) ON CONFLICT(ns) DO UPDATE SET account=excluded.account, updated_at=excluded.updated_at")
                .run(ns, tenant, owner, subject, account, t, t, randomBytes(16).toString("hex"));
        });
        return this.namespace(ns)!;
    }
    namespace(ns: string): InboxNamespace | null {
        const r = this.db.prepare("SELECT * FROM inbox_namespace WHERE ns=?").get(ns) as Record<string, unknown> | undefined;
        if (!r)
            return null;
        return {
            ns: r.ns as string,
            tenant: r.tenant as string,
            owner: r.owner as string,
            subject: r.subject as string,
            account: r.account as string,
            historyId: (r.history_id as string | null) ?? null,
            syncState: r.sync_state as NamespaceSyncState,
            catchupPending: r.catchup_pending === 1,
            lastError: (r.last_error as string | null) ?? null,
            updatedAt: r.updated_at as number,
        };
    }
    setNamespaceError(ns: string, token: string, code: string | null, state?: NamespaceSyncState) {
        this.fenced(ns, token, () => this.db
            .prepare("UPDATE inbox_namespace SET last_error=?, sync_state=COALESCE(?, sync_state), updated_at=? WHERE ns=?")
            .run(code, state ?? null, this.now(), ns));
    }
    activeRun(ns: string): FullRun | null {
        const r = this.db
            .prepare("SELECT * FROM inbox_full_run WHERE ns=? AND phase IN ('enumerate','select','fetch') ORDER BY started_at DESC LIMIT 1")
            .get(ns) as Record<string, unknown> | undefined;
        return r ? this.mapRun(r) : null;
    }
    run(runId: string): FullRun | null {
        const r = this.db.prepare("SELECT * FROM inbox_full_run WHERE run_id=?").get(runId) as Record<string, unknown> | undefined;
        return r ? this.mapRun(r) : null;
    }
    private mapRun(r: Record<string, unknown>): FullRun {
        return {
            runId: r.run_id as string,
            ns: r.ns as string,
            startedAt: r.started_at as number,
            h0: r.h0 as string,
            windowStartMs: r.window_start_ms as number,
            phase: r.phase as RunPhase,
            candidates: r.candidates as number,
            selected: r.selected as number,
            truncated: r.truncated === 1,
            completedAt: (r.completed_at as number | null) ?? null,
        };
    }
    private ownedRun(ns: string, runId: string, phase?: RunPhase): FullRun {
        const run = this.run(runId);
        if (!run || run.ns !== ns)
            throw new InboxStoreError("INBOX_RUN_NAMESPACE_MISMATCH");
        if (phase && run.phase !== phase)
            throw new InboxStoreError("INBOX_RUN_PHASE");
        return run;
    }
    createRun(ns: string, token: string, h0: string, windowStartMs: number): FullRun {
        const runId = randomBytes(12).toString("hex");
        this.fenced(ns, token, () => {
            this.db.prepare("UPDATE inbox_full_run SET phase='abandoned' WHERE ns=? AND phase IN ('enumerate','select','fetch')").run(ns);
            this.db
                .prepare("INSERT INTO inbox_full_run(run_id,ns,started_at,h0,window_start_ms,phase) VALUES(?,?,?,?,?,'enumerate')")
                .run(runId, ns, this.now(), h0, windowStartMs);
            this.db
                .prepare("UPDATE inbox_namespace SET sync_state=CASE WHEN history_id IS NULL THEN 'in_progress' ELSE sync_state END, last_error=NULL, updated_at=? WHERE ns=?")
                .run(this.now(), ns);
        });
        return this.run(runId)!;
    }
    abandonRun(ns: string, token: string, runId: string) {
        this.fenced(ns, token, () => {
            this.ownedRun(ns, runId);
            this.db.prepare("UPDATE inbox_full_run SET phase='abandoned' WHERE run_id=?").run(runId);
            this.db.prepare("DELETE FROM inbox_candidate WHERE run_id=?").run(runId);
        });
    }
    /** Stores the complete, de-duplicated candidate id set and moves to select. */
    finishEnumeration(ns: string, token: string, runId: string, ids: Iterable<string>) {
        this.fenced(ns, token, () => {
            this.ownedRun(ns, runId, "enumerate");
            const ins = this.db.prepare("INSERT OR IGNORE INTO inbox_candidate(run_id,gmail_id) VALUES(?,?)");
            for (const id of ids)
                ins.run(runId, id);
            const n = (this.db.prepare("SELECT COUNT(*) n FROM inbox_candidate WHERE run_id=?").get(runId) as {
                n: number;
            }).n;
            this.db.prepare("UPDATE inbox_full_run SET phase='select', candidates=? WHERE run_id=? AND phase='enumerate'").run(n, runId);
        });
    }
    candidatesNeedingDate(runId: string, limit: number): string[] {
        return (this.db
            .prepare("SELECT gmail_id FROM inbox_candidate WHERE run_id=? AND minimal_done=0 ORDER BY gmail_id LIMIT ?")
            .all(runId, limit) as {
            gmail_id: string;
        }[]).map((r) => r.gmail_id);
    }
    recordCandidateDate(ns: string, token: string, runId: string, gmailId: string, internalDate: number | null, outcome: string | null) {
        this.fenced(ns, token, () => {
            this.ownedRun(ns, runId, "select");
            const result = this.db.prepare("UPDATE inbox_candidate SET internal_date=?, minimal_done=1, outcome=? WHERE run_id=? AND gmail_id=?")
                .run(internalDate, outcome, runId, gmailId);
            if (result.changes !== 1)
                throw new InboxStoreError("INBOX_CANDIDATE_INVALID");
        });
    }
    /**
     * Fixes the selection: all candidates if within `cap`; otherwise the `cap`
     * candidates with the greatest internalDate (ties by gmail_id), using dates
     * already recorded for every candidate. Deterministic for a given set.
     */
    select(ns: string, token: string, runId: string, cap: number): {
        selected: number;
        truncated: boolean;
    } {
        return this.fenced(ns, token, () => {
            const run = this.ownedRun(ns, runId);
            if (run.phase !== "select")
                throw new InboxStoreError("INBOX_RUN_PHASE");
            let truncated = false;
            if (run.candidates <= cap)
                this.db.prepare("UPDATE inbox_candidate SET selected=1 WHERE run_id=?").run(runId);
            else {
                const pending = (this.db.prepare("SELECT COUNT(*) n FROM inbox_candidate WHERE run_id=? AND minimal_done=0").get(runId) as {
                    n: number;
                }).n;
                if (pending)
                    throw new InboxStoreError("INBOX_SELECTION_DATES_PENDING");
                const valid = (this.db.prepare("SELECT COUNT(*) n FROM inbox_candidate WHERE run_id=? AND outcome IS NULL AND internal_date IS NOT NULL").get(runId) as {
                    n: number;
                }).n;
                truncated = valid > cap;
                this.db
                    .prepare("UPDATE inbox_candidate SET selected=1 WHERE run_id=? AND gmail_id IN (SELECT gmail_id FROM inbox_candidate WHERE run_id=? AND outcome IS NULL AND internal_date IS NOT NULL ORDER BY internal_date DESC, gmail_id DESC LIMIT ?)")
                    .run(runId, runId, cap);
            }
            const n = (this.db.prepare("SELECT COUNT(*) n FROM inbox_candidate WHERE run_id=? AND selected=1").get(runId) as {
                n: number;
            }).n;
            this.db.prepare("UPDATE inbox_full_run SET phase='fetch', selected=?, truncated=? WHERE run_id=?").run(n, truncated ? 1 : 0, runId);
            return { selected: n, truncated };
        });
    }
    selectedToFetch(runId: string, limit: number): string[] {
        return (this.db
            .prepare("SELECT gmail_id FROM inbox_candidate WHERE run_id=? AND selected=1 AND fetched=0 ORDER BY gmail_id LIMIT ?")
            .all(runId, limit) as {
            gmail_id: string;
        }[]).map((r) => r.gmail_id);
    }
    /** Upserts messages and marks them fetched in one fenced transaction. */
    writeBatch(ns: string, token: string, runId: string, messages: MessageInput[], skipped: {
        gmailId: string;
        outcome: string;
    }[]) {
        this.fenced(ns, token, () => {
            this.ownedRun(ns, runId, "fetch");
            for (const id of [...messages.map(m => m.gmailId), ...skipped.map(m => m.gmailId)]) {
                const candidate = this.db.prepare("SELECT selected FROM inbox_candidate WHERE run_id=? AND gmail_id=?").get(runId, id);
                if (!candidate || candidate.selected !== 1)
                    throw new InboxStoreError("INBOX_CANDIDATE_INVALID");
            }
            const t = this.now();
            const up = this.db.prepare(`INSERT INTO inbox_message(ns,gmail_id,thread_id,internal_date,labels,from_h,to_h,cc_h,reply_to_h,subject_h,date_h,message_id_h,in_reply_to_h,references_h,snippet,body_text,body_source,body_truncated,size_estimate,deleted_at,first_seen_at,updated_at,quality_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?)
        ON CONFLICT(ns,gmail_id) DO UPDATE SET thread_id=excluded.thread_id, internal_date=excluded.internal_date,
        labels=excluded.labels, from_h=excluded.from_h, to_h=excluded.to_h, cc_h=excluded.cc_h, reply_to_h=excluded.reply_to_h,
        subject_h=excluded.subject_h, date_h=excluded.date_h, message_id_h=excluded.message_id_h, in_reply_to_h=excluded.in_reply_to_h,
        references_h=excluded.references_h, snippet=excluded.snippet, body_text=excluded.body_text, body_source=excluded.body_source,
        body_truncated=excluded.body_truncated, size_estimate=excluded.size_estimate, deleted_at=NULL, updated_at=excluded.updated_at, quality_json=excluded.quality_json,
        scope_state='active', scope_changed_at=CASE WHEN inbox_message.scope_state='active' THEN inbox_message.scope_changed_at ELSE excluded.updated_at END, confirmed_at=excluded.updated_at`);
            const delAtt = this.db.prepare("DELETE FROM inbox_attachment WHERE ns=? AND gmail_id=?");
            const insAtt = this.db.prepare("INSERT OR REPLACE INTO inbox_attachment VALUES(?,?,?,?,?,?)");
            const mark = this.db.prepare("UPDATE inbox_candidate SET fetched=1, outcome=? WHERE run_id=? AND gmail_id=?");
            for (const m of messages) {
                const p = m.parsed, h = p.headers;
                up.run(ns, m.gmailId, m.threadId, m.internalDate, JSON.stringify(m.labels), h.from, h.to, h.cc, h.replyTo, h.subject, h.date, h.messageId, h.inReplyTo, h.references, m.snippet, m.tooLarge ? "" : p.bodyText, m.tooLarge ? "too_large" : p.bodySource, m.tooLarge || p.bodyTruncated ? 1 : 0, m.sizeEstimate, t, t, JSON.stringify({ addressAmbiguous: p.addressAmbiguous ?? true, charsetFallback: p.charsetFallback, attachmentsTruncated: p.attachmentsTruncated, structureTruncated: p.structureTruncated, bodyUnavailable: m.tooLarge || p.bodyUnavailable }));
                delAtt.run(ns, m.gmailId);
                for (const a of p.attachments)
                    insAtt.run(ns, m.gmailId, a.partId, a.filename, a.mimeType, a.size);
                mark.run(null, runId, m.gmailId);
            }
            for (const s of skipped)
                mark.run(s.outcome, runId, s.gmailId);
            if (messages.length) {
                this.bumpRevision(ns);
                this.db.prepare("UPDATE inbox_resync_local SET done=1 WHERE ns=? AND gmail_id IN (SELECT value FROM json_each(?))").run(ns, JSON.stringify(messages.map(m => m.gmailId)));
            }
            this.db.prepare("UPDATE inbox_message SET confirmed_at=? WHERE ns=? AND gmail_id IN (SELECT value FROM json_each(?))").run(t, ns, JSON.stringify(messages.map(m => m.gmailId)));
        });
    }
    /**
     * Completes the run: confirms H0 as the namespace cursor only when every
     * selected candidate has been fetched or explicitly skipped.
     */
    completeRun(ns: string, token: string, runId: string) {
        this.fenced(ns, token, () => {
            const run = this.ownedRun(ns, runId);
            const left = (this.db.prepare("SELECT COUNT(*) n FROM inbox_candidate WHERE run_id=? AND selected=1 AND fetched=0").get(runId) as {
                n: number;
            }).n;
            if (run.phase !== "fetch" || left)
                throw new InboxStoreError("INBOX_RUN_INCOMPLETE");
            this.db.prepare("UPDATE inbox_full_run SET phase='done', completed_at=? WHERE run_id=?").run(this.now(), runId);
            this.db
                .prepare("UPDATE inbox_namespace SET history_id=?, sync_state=?, catchup_pending=1, last_error=NULL, updated_at=?, window_start_ms=?, last_sync_at=? WHERE ns=?")
                .run(run.h0, run.truncated ? "complete_truncated" : "complete_window", this.now(), run.windowStartMs, this.now(), ns);
            this.db.prepare("DELETE FROM inbox_candidate WHERE run_id=?").run(runId);
            // A full run started after a resync began satisfies its "new full sync" step.
            this.db.prepare("UPDATE inbox_resync SET full_done=1 WHERE ns=? AND started_at<=?").run(ns, run.startedAt);
        });
    }
    message(ns: string, gmailId: string): StoredMessage | null {
        const r = this.db.prepare("SELECT * FROM inbox_message WHERE ns=? AND gmail_id=? AND deleted_at IS NULL").get(ns, gmailId) as Record<string, unknown> | undefined;
        if (!r)
            return null;
        return {
            gmailId: r.gmail_id as string,
            threadId: r.thread_id as string | null,
            internalDate: r.internal_date as number | null,
            labels: JSON.parse(r.labels as string),
            from: r.from_h as string | null,
            to: r.to_h as string | null,
            cc: r.cc_h as string | null,
            replyTo: r.reply_to_h as string | null,
            subject: r.subject_h as string | null,
            date: r.date_h as string | null,
            messageId: r.message_id_h as string | null,
            inReplyTo: r.in_reply_to_h as string | null,
            references: r.references_h as string | null,
            snippet: r.snippet as string | null,
            bodyText: r.body_text as string,
            bodySource: r.body_source as StoredMessage["bodySource"],
            bodyTruncated: r.body_truncated === 1,
            sizeEstimate: r.size_estimate as number | null,
            quality: typeof r.quality_json === "string" ? JSON.parse(r.quality_json) : null,
            firstSeenAt: r.first_seen_at as number,
            updatedAt: r.updated_at as number,
        };
    }
    attachments(ns: string, gmailId: string) {
        return this.db
            .prepare("SELECT part_id partId, filename, mime_type mimeType, size FROM inbox_attachment WHERE ns=? AND gmail_id=? ORDER BY part_id")
            .all(ns, gmailId) as {
            partId: string;
            filename: string;
            mimeType: string;
            size: number;
        }[];
    }
    messageIds(ns: string): string[] {
        return (this.db.prepare("SELECT gmail_id FROM inbox_message WHERE ns=? AND deleted_at IS NULL ORDER BY gmail_id").all(ns) as {
            gmail_id: string;
        }[]).map((r) => r.gmail_id);
    }
    /**
     * D3 contract (P03): deletes this namespace's synchronised inbox data and
     * cursor. Touches only this store (never CRM or runtime journal). Refuses
     * while a sync holds the lease. P04 API uses purgeConfirmed().
     */
    purgeNamespace(ns: string) {
        this.tx(() => {
            this.assertNoActiveLease(ns);
            this.purgeRows(ns, false);
        });
    }
    // ---------------------------------------------------------------- P04 ---
    private migrateV3() {
        this.db.exec("CREATE TABLE IF NOT EXISTS inbox_history_token(ns TEXT NOT NULL, token TEXT NOT NULL, PRIMARY KEY(ns,token))");
        const has = (table: string, column: string) => (this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(c => c.name === column);
        const add = (table: string, column: string, decl: string) => { if (!has(table, column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`); };
        add("inbox_message", "scope_state", "TEXT NOT NULL DEFAULT 'active'");
        add("inbox_message", "scope_changed_at", "INTEGER");
        add("inbox_message", "confirmed_at", "INTEGER");
        add("inbox_namespace", "account_ref", "TEXT");
        add("inbox_namespace", "revision", "INTEGER NOT NULL DEFAULT 0");
        add("inbox_namespace", "resync_required", "INTEGER NOT NULL DEFAULT 0");
        add("inbox_namespace", "auto_sync_paused", "INTEGER NOT NULL DEFAULT 0");
        add("inbox_namespace", "window_start_ms", "INTEGER");
        add("inbox_namespace", "last_sync_at", "INTEGER");
        add("inbox_namespace", "next_sync_at", "INTEGER");
        add("inbox_namespace", "backoff_ms", "INTEGER NOT NULL DEFAULT 0");
        this.db.exec(`UPDATE inbox_message SET scope_state='deleted' WHERE deleted_at IS NOT NULL AND scope_state='active';
UPDATE inbox_namespace SET account_ref=lower(hex(randomblob(16))) WHERE account_ref IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inbox_namespace_ref ON inbox_namespace(account_ref);
CREATE INDEX IF NOT EXISTS inbox_namespace_owner ON inbox_namespace(tenant, owner, updated_at DESC);
CREATE INDEX IF NOT EXISTS inbox_message_order ON inbox_message(ns, scope_state, COALESCE(internal_date,-1) DESC, gmail_id DESC);
CREATE TABLE IF NOT EXISTS inbox_incremental(ns TEXT PRIMARY KEY, start_history TEXT NOT NULL, target_history TEXT, phase TEXT NOT NULL,
  page_token TEXT, last_history TEXT, pages INTEGER NOT NULL DEFAULT 0, list_restarts INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS inbox_touched(ns TEXT NOT NULL, gmail_id TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(ns, gmail_id));
CREATE TABLE IF NOT EXISTS inbox_resync(ns TEXT PRIMARY KEY, started_at INTEGER NOT NULL, full_done INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS inbox_resync_local(ns TEXT NOT NULL, gmail_id TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(ns, gmail_id));
CREATE TABLE IF NOT EXISTS inbox_purge_token(token_hash TEXT PRIMARY KEY, ns TEXT NOT NULL, tenant TEXT NOT NULL, owner TEXT NOT NULL,
  revision INTEGER NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);`);
    }
    private bumpRevision(ns: string) {
        this.db.prepare("UPDATE inbox_namespace SET revision=revision+1, updated_at=? WHERE ns=?").run(this.now(), ns);
    }
    private assertNoActiveLease(ns: string) {
        const lease = this.db.prepare("SELECT expires_at FROM inbox_lease WHERE ns=?").get(ns) as { expires_at: number } | undefined;
        if (lease && lease.expires_at >= this.now())
            throw new InboxStoreError("INBOX_SYNC_ACTIVE");
    }
    private purgeRows(ns: string, pause: boolean) {
        for (const table of ["inbox_assistance", "inbox_message", "inbox_attachment", "inbox_touched", "inbox_incremental", "inbox_resync", "inbox_resync_local", "inbox_history_token"])
            this.db.prepare(`DELETE FROM ${table} WHERE ns=?`).run(ns);
        this.db.prepare("DELETE FROM inbox_candidate WHERE run_id IN (SELECT run_id FROM inbox_full_run WHERE ns=?)").run(ns);
        this.db.prepare("DELETE FROM inbox_full_run WHERE ns=?").run(ns);
        this.db.prepare("UPDATE inbox_namespace SET history_id=NULL, sync_state='never', catchup_pending=0, last_error=NULL, resync_required=0, window_start_ms=NULL, last_sync_at=NULL, next_sync_at=NULL, backoff_ms=0, auto_sync_paused=CASE WHEN ? THEN 1 ELSE auto_sync_paused END, updated_at=? WHERE ns=?")
            .run(pause ? 1 : 0, this.now(), ns);
        this.bumpRevision(ns);
    }
    /** Extended namespace view used by P04 service and API. */
    namespaceInfo(ns: string): InboxNamespaceInfo | null {
        const base = this.namespace(ns);
        if (!base) return null;
        const r = this.db.prepare("SELECT account_ref, revision, resync_required, auto_sync_paused, window_start_ms, last_sync_at, next_sync_at, backoff_ms FROM inbox_namespace WHERE ns=?").get(ns) as Record<string, number | string | null>;
        const count = (this.db.prepare("SELECT COUNT(*) n FROM inbox_message WHERE ns=? AND scope_state!='deleted'").get(ns) as { n: number }).n;
        return { ...base, accountRef: r.account_ref as string, revision: r.revision as number, resyncRequired: r.resync_required === 1,
            autoSyncPaused: r.auto_sync_paused === 1, windowStartMs: (r.window_start_ms as number | null) ?? null, lastSyncAt: (r.last_sync_at as number | null) ?? null,
            nextSyncAt: (r.next_sync_at as number | null) ?? null, backoffMs: r.backoff_ms as number, messageCount: count,
            incrementalActive: !!this.db.prepare("SELECT 1 FROM inbox_incremental WHERE ns=?").get(ns),
            fullRunActive: !!this.activeRun(ns) };
    }
    namespacesForOwner(tenant: string, owner: string): InboxNamespaceInfo[] {
        return (this.db.prepare("SELECT ns FROM inbox_namespace WHERE tenant=? AND owner=? ORDER BY updated_at DESC, ns").all(tenant, owner) as { ns: string }[])
            .map(r => this.namespaceInfo(r.ns)!);
    }
    namespaceByRef(ref: string): InboxNamespaceInfo | null {
        if (!/^[a-f0-9]{32}$/.test(ref)) return null;
        const r = this.db.prepare("SELECT ns FROM inbox_namespace WHERE account_ref=?").get(ref) as { ns: string } | undefined;
        return r ? this.namespaceInfo(r.ns) : null;
    }
    setSchedule(ns: string, input: { nextSyncAt: number | null; backoffMs: number; lastSyncAt?: number }) {
        this.tx(() => this.db.prepare("UPDATE inbox_namespace SET next_sync_at=?, backoff_ms=?, last_sync_at=COALESCE(?, last_sync_at) WHERE ns=?")
            .run(input.nextSyncAt, input.backoffMs, input.lastSyncAt ?? null, ns));
    }
    /** Explicit manual sync is the only way to lift the post-purge pause. */
    resumeAutoSync(ns: string) {
        this.tx(() => this.db.prepare("UPDATE inbox_namespace SET auto_sync_paused=0 WHERE ns=?").run(ns));
    }
    // Incremental run (durable checkpoints) --------------------------------
    incrementalRun(ns: string): IncrementalRun | null {
        const r = this.db.prepare("SELECT * FROM inbox_incremental WHERE ns=?").get(ns) as Record<string, unknown> | undefined;
        if (!r) return null;
        const pending = (this.db.prepare("SELECT COUNT(*) n FROM inbox_touched WHERE ns=? AND done=0").get(ns) as { n: number }).n;
        const touched = (this.db.prepare("SELECT COUNT(*) n FROM inbox_touched WHERE ns=?").get(ns) as { n: number }).n;
        return { startHistory: r.start_history as string, targetHistory: (r.target_history as string | null) ?? null,
            phase: r.phase as "list" | "reconcile", pageToken: (r.page_token as string | null) ?? null, pages: r.pages as number,
            listRestarts: r.list_restarts as number, startedAt: r.started_at as number, pending, touched };
    }
    startIncremental(ns: string, token: string): IncrementalRun {
        this.fenced(ns, token, () => {
            const n = this.namespace(ns);
            if (!n?.historyId || this.activeRun(ns) || this.db.prepare("SELECT 1 FROM inbox_resync WHERE ns=?").get(ns))
                throw new InboxStoreError("INBOX_INCREMENTAL_NOT_READY");
            if (!this.db.prepare("SELECT 1 FROM inbox_incremental WHERE ns=?").get(ns))
                this.db.prepare("INSERT INTO inbox_incremental(ns,start_history,phase,started_at) VALUES(?,?,'list',?)").run(ns, n.historyId, this.now());
        });
        return this.incrementalRun(ns)!;
    }
    /** Records one validated history page. Returns "overflow" above maxTouched. */
    recordHistoryPage(ns: string, token: string, page: { ids: string[]; nextPageToken: string | null; historyId: string }, maxTouched: number): "more" | "listed" | "overflow" {
        return this.fenced(ns, token, () => {
            const run = this.incrementalRun(ns);
            if (!run || run.phase !== "list") throw new InboxStoreError("INBOX_INCREMENTAL_PHASE");
            if (page.nextPageToken !== null) {
                if (this.db.prepare("SELECT 1 FROM inbox_history_token WHERE ns=? AND token=?").get(ns,page.nextPageToken)) throw new InboxStoreError("INBOX_HISTORY_PAGINATION_INVALID");
                this.db.prepare("INSERT INTO inbox_history_token(ns,token) VALUES(?,?)").run(ns,page.nextPageToken);
            }
            const ins = this.db.prepare("INSERT OR IGNORE INTO inbox_touched(ns,gmail_id) VALUES(?,?)");
            for (const id of page.ids) ins.run(ns, id);
            const touched = (this.db.prepare("SELECT COUNT(*) n FROM inbox_touched WHERE ns=?").get(ns) as { n: number }).n;
            if (touched > maxTouched) return "overflow";
            if (page.nextPageToken === null)
                this.db.prepare("UPDATE inbox_incremental SET phase='reconcile', target_history=?, last_history=?, page_token=NULL, pages=pages+1 WHERE ns=?").run(page.historyId, page.historyId, ns);
            else
                this.db.prepare("UPDATE inbox_incremental SET page_token=?, last_history=?, pages=pages+1 WHERE ns=?").run(page.nextPageToken, page.historyId, ns);
            return page.nextPageToken === null ? "listed" : "more";
        });
    }
    /** A rejected page token restarts listing from the same start; touched ids are kept (superset). */
    restartIncrementalListing(ns: string, token: string): number {
        return this.fenced(ns, token, () => {
            this.db.prepare("DELETE FROM inbox_history_token WHERE ns=?").run(ns);
            this.db.prepare("UPDATE inbox_incremental SET page_token=NULL, list_restarts=list_restarts+1 WHERE ns=? AND phase='list'").run(ns);
            return this.incrementalRun(ns)?.listRestarts ?? 0;
        });
    }
    touchedPending(ns: string, limit: number): string[] {
        return (this.db.prepare("SELECT gmail_id FROM inbox_touched WHERE ns=? AND done=0 ORDER BY gmail_id LIMIT ?").all(ns, limit) as { gmail_id: string }[]).map(r => r.gmail_id);
    }
    /** CAS publication: only if the namespace cursor is still the run's start and nothing is pending. */
    finishIncremental(ns: string, token: string) {
        this.fenced(ns, token, () => {
            const run = this.incrementalRun(ns), n = this.namespace(ns);
            if (!run || run.phase !== "reconcile" || run.pending || !run.targetHistory) throw new InboxStoreError("INBOX_INCREMENTAL_INCOMPLETE");
            if (!n || n.historyId !== run.startHistory) throw new InboxStoreError("INBOX_CURSOR_CONFLICT");
            this.db.prepare("UPDATE inbox_namespace SET history_id=?, catchup_pending=0, last_error=NULL, last_sync_at=?, updated_at=? WHERE ns=? AND history_id=?")
                .run(run.targetHistory, this.now(), this.now(), ns, run.startHistory);
            this.db.prepare("DELETE FROM inbox_touched WHERE ns=?").run(ns);
            this.db.prepare("DELETE FROM inbox_incremental WHERE ns=?").run(ns);
            this.db.prepare("DELETE FROM inbox_history_token WHERE ns=?").run(ns);
        });
    }
    // Resync after an expired cursor or overflow ----------------------------
    resyncActive(ns: string) {
        const r = this.db.prepare("SELECT started_at, full_done FROM inbox_resync WHERE ns=?").get(ns) as { started_at: number; full_done: number } | undefined;
        if (!r) return null;
        const pending = (this.db.prepare("SELECT COUNT(*) n FROM inbox_resync_local WHERE ns=? AND done=0").get(ns) as { n: number }).n;
        return { startedAt: r.started_at, fullDone: r.full_done === 1, pending };
    }
    /** Snapshot every locally known id (active, archived and tombstones) before the new full sync. */
    startResync(ns: string, token: string) {
        this.fenced(ns, token, () => {
            if (this.db.prepare("SELECT 1 FROM inbox_resync WHERE ns=?").get(ns)) return;
            this.db.prepare("UPDATE inbox_full_run SET phase='abandoned' WHERE ns=? AND phase IN ('enumerate','select','fetch')").run(ns);
            this.db.prepare("INSERT INTO inbox_resync(ns,started_at,full_done) VALUES(?,?,0)").run(ns, this.now());
            this.db.prepare("INSERT OR IGNORE INTO inbox_resync_local(ns,gmail_id) SELECT ns, gmail_id FROM inbox_message WHERE ns=?").run(ns);
            this.db.prepare("DELETE FROM inbox_touched WHERE ns=?").run(ns);
            this.db.prepare("DELETE FROM inbox_incremental WHERE ns=?").run(ns);
            this.db.prepare("DELETE FROM inbox_history_token WHERE ns=?").run(ns);
            this.db.prepare("UPDATE inbox_namespace SET resync_required=1, updated_at=? WHERE ns=?").run(this.now(), ns);
        });
    }
    /** Ids from the snapshot that the new full sync did not already confirm. */
    resyncPending(ns: string, limit: number): string[] {
        return (this.db.prepare("SELECT gmail_id FROM inbox_resync_local WHERE ns=? AND done=0 ORDER BY gmail_id LIMIT ?").all(ns, limit) as { gmail_id: string }[]).map(r => r.gmail_id);
    }
    finishResync(ns: string, token: string) {
        this.fenced(ns, token, () => {
            const r = this.resyncActive(ns);
            if (!r || !r.fullDone || r.pending || this.activeRun(ns) || !this.namespace(ns)?.historyId) throw new InboxStoreError("INBOX_RESYNC_INCOMPLETE");
            this.db.prepare("DELETE FROM inbox_resync_local WHERE ns=?").run(ns);
            this.db.prepare("DELETE FROM inbox_resync WHERE ns=?").run(ns);
            this.db.prepare("UPDATE inbox_namespace SET resync_required=0, last_error=NULL, updated_at=? WHERE ns=?").run(this.now(), ns);
        });
    }
    // Current-state application (D7) ---------------------------------------
    localState(ns: string, gmailId: string): { scopeState: "active" | "archived" | "deleted" } | null {
        const r = this.db.prepare("SELECT scope_state FROM inbox_message WHERE ns=? AND gmail_id=?").get(ns, gmailId) as { scope_state: string } | undefined;
        return r ? { scopeState: r.scope_state as "active" | "archived" | "deleted" } : null;
    }
    /**
     * Applies the current Gmail state of one message. Idempotent; marks the
     * item done in the incremental and/or resync work list in the same
     * transaction. Deleted: body, snippet, headers and attachments are removed;
     * only id, thread, date, labels and timestamps remain as a tombstone.
     */
    applyState(ns: string, token: string, gmailId: string, decision: StateDecision, work: { touched?: boolean; resync?: boolean }) {
        this.fenced(ns, token, () => {
            const t = this.now();
            const row = this.localState(ns, gmailId);
            let changed = false;
            if (decision.kind === "delete") {
                if (row && row.scopeState !== "deleted") {
                    this.db.prepare(`UPDATE inbox_message SET scope_state='deleted', scope_changed_at=?, deleted_at=?, updated_at=?, body_text='', body_source='none', body_truncated=0,
                        snippet=NULL, from_h=NULL, to_h=NULL, cc_h=NULL, reply_to_h=NULL, subject_h=NULL, date_h=NULL, message_id_h=NULL, in_reply_to_h=NULL, references_h=NULL,
                        quality_json=?, labels=? WHERE ns=? AND gmail_id=?`).run(t, t, t, JSON.stringify({ contentRemoved: true }), JSON.stringify(decision.labels ?? []), ns, gmailId);
                    this.db.prepare("DELETE FROM inbox_attachment WHERE ns=? AND gmail_id=?").run(ns, gmailId);
                    changed = true;
                }
            }
            else if (decision.kind === "archive") {
                if (row && row.scopeState === "active") {
                    this.db.prepare("UPDATE inbox_message SET scope_state='archived', scope_changed_at=?, labels=?, updated_at=?, confirmed_at=? WHERE ns=? AND gmail_id=?").run(t, JSON.stringify(decision.labels), t, t, ns, gmailId);
                    changed = true;
                }
                else if (row && row.scopeState === "archived") {
                    this.db.prepare("UPDATE inbox_message SET labels=?, confirmed_at=? WHERE ns=? AND gmail_id=?").run(JSON.stringify(decision.labels), t, ns, gmailId);
                    changed = true;
                }
            }
            else if (decision.kind === "labels") {
                if (!row || row.scopeState === "deleted") throw new InboxStoreError("INBOX_STATE_REQUIRES_CONTENT");
                this.db.prepare("UPDATE inbox_message SET scope_state='active', scope_changed_at=CASE WHEN scope_state='active' THEN scope_changed_at ELSE ? END, labels=?, updated_at=?, confirmed_at=? WHERE ns=? AND gmail_id=?")
                    .run(t, JSON.stringify(decision.labels), t, t, ns, gmailId);
                changed = true; // any applied write invalidates outstanding purge confirmations
            }
            else if (decision.kind === "content") {
                this.upsertContent(ns, decision.message, t);
                changed = true;
            }
            if (changed) this.bumpRevision(ns);
            if (work.touched) this.db.prepare("UPDATE inbox_touched SET done=1 WHERE ns=? AND gmail_id=?").run(ns, gmailId);
            if (work.resync) this.db.prepare("UPDATE inbox_resync_local SET done=1 WHERE ns=? AND gmail_id=?").run(ns, gmailId);
        });
    }
    private upsertContent(ns: string, m: MessageInput, t: number) {
        const p = m.parsed, h = p.headers;
        this.db.prepare(`INSERT INTO inbox_message(ns,gmail_id,thread_id,internal_date,labels,from_h,to_h,cc_h,reply_to_h,subject_h,date_h,message_id_h,in_reply_to_h,references_h,snippet,body_text,body_source,body_truncated,size_estimate,deleted_at,first_seen_at,updated_at,quality_json,scope_state,scope_changed_at,confirmed_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,'active',?,?)
            ON CONFLICT(ns,gmail_id) DO UPDATE SET thread_id=excluded.thread_id, internal_date=excluded.internal_date, labels=excluded.labels, from_h=excluded.from_h, to_h=excluded.to_h,
            cc_h=excluded.cc_h, reply_to_h=excluded.reply_to_h, subject_h=excluded.subject_h, date_h=excluded.date_h, message_id_h=excluded.message_id_h, in_reply_to_h=excluded.in_reply_to_h,
            references_h=excluded.references_h, snippet=excluded.snippet, body_text=excluded.body_text, body_source=excluded.body_source, body_truncated=excluded.body_truncated,
            size_estimate=excluded.size_estimate, deleted_at=NULL, updated_at=excluded.updated_at, quality_json=excluded.quality_json, scope_state='active', scope_changed_at=excluded.scope_changed_at, confirmed_at=excluded.confirmed_at`)
            .run(ns, m.gmailId, m.threadId, m.internalDate, JSON.stringify(m.labels), h.from, h.to, h.cc, h.replyTo, h.subject, h.date, h.messageId, h.inReplyTo, h.references, m.snippet,
            m.tooLarge ? "" : p.bodyText, m.tooLarge ? "too_large" : p.bodySource, m.tooLarge || p.bodyTruncated ? 1 : 0, m.sizeEstimate, t, t,
            JSON.stringify({ addressAmbiguous: p.addressAmbiguous ?? true, charsetFallback: p.charsetFallback, attachmentsTruncated: p.attachmentsTruncated, structureTruncated: p.structureTruncated, bodyUnavailable: m.tooLarge || p.bodyUnavailable }), t, t);
        this.db.prepare("DELETE FROM inbox_attachment WHERE ns=? AND gmail_id=?").run(ns, m.gmailId);
        const ins = this.db.prepare("INSERT OR REPLACE INTO inbox_attachment VALUES(?,?,?,?,?,?)");
        for (const a of p.attachments) ins.run(ns, m.gmailId, a.partId, a.filename, a.mimeType, a.size);
    }
    // Listing (keyset, bound cursor) ---------------------------------------
    listMessages(ns: string, input: { scope: ListScope; query: string; cursor: string | null; limit: number }): { items: MessageSummary[]; nextCursor: string | null } {
        if (!["inbox", "sent", "archived"].includes(input.scope) || input.query.length > 100 || /[\u0000-\u001f\u007f]/.test(input.query) || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 50)
            throw new InboxStoreError("INBOX_LIST_INVALID");
        const binding = createHash("sha256").update(JSON.stringify([ns, input.scope, input.query])).digest("hex").slice(0, 24);
        let after: { d: number; id: string } | null = null;
        if (input.cursor !== null) {
            try {
                const c = JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8"));
                if (!c || c.v !== 1 || c.k !== binding || !Number.isSafeInteger(c.d) || c.d < -1 || typeof c.id !== "string" || !/^[-a-zA-Z0-9_]{1,100}$/.test(c.id)) throw 0;
                after = { d: c.d, id: c.id };
            }
            catch {
                throw new InboxStoreError("INBOX_CURSOR_INVALID");
            }
        }
        const where = ["ns=?"], args: (string | number)[] = [ns];
        if (input.scope === "archived") where.push("scope_state='archived'");
        else { where.push("scope_state='active'"); where.push("labels LIKE ?"); args.push(input.scope === "sent" ? '%"SENT"%' : '%"INBOX"%'); }
        if (input.query) {
            const like = "%" + input.query.replace(/[\\%_]/g, c => "\\" + c) + "%";
            where.push("(subject_h LIKE ? ESCAPE '\\' OR from_h LIKE ? ESCAPE '\\' OR snippet LIKE ? ESCAPE '\\')");
            args.push(like, like, like);
        }
        if (after) { where.push("(COALESCE(internal_date,-1) < ? OR (COALESCE(internal_date,-1) = ? AND gmail_id < ?))"); args.push(after.d, after.d, after.id); }
        const rows = this.db.prepare(`SELECT gmail_id, thread_id, internal_date, labels, from_h, to_h, subject_h, snippet, scope_state, body_source,
            (SELECT COUNT(*) FROM inbox_attachment a WHERE a.ns=inbox_message.ns AND a.gmail_id=inbox_message.gmail_id) attachments
            FROM inbox_message WHERE ${where.join(" AND ")} ORDER BY COALESCE(internal_date,-1) DESC, gmail_id DESC LIMIT ?`).all(...args, input.limit + 1) as Record<string, unknown>[];
        const page = rows.slice(0, input.limit);
        const items = page.map(r => ({ gmailId: r.gmail_id as string, threadId: (r.thread_id as string | null) ?? null, internalDate: (r.internal_date as number | null) ?? null,
            labels: JSON.parse(r.labels as string) as string[], from: (r.from_h as string | null) ?? null, to: (r.to_h as string | null) ?? null, subject: (r.subject_h as string | null) ?? null,
            snippet: (r.snippet as string | null) ?? null, scopeState: r.scope_state as "active" | "archived", bodySource: r.body_source as StoredMessage["bodySource"], attachmentCount: r.attachments as number }));
        const last = items.at(-1);
        const nextCursor = rows.length > input.limit && last ? Buffer.from(JSON.stringify({ v: 1, k: binding, d: last.internalDate ?? -1, id: last.gmailId })).toString("base64url") : null;
        return { items, nextCursor };
    }
    /** Detail including scope state; deleted messages are never returned. */
    messageDetail(ns: string, gmailId: string) {
        const m = this.message(ns, gmailId);
        if (!m) return null;
        const r = this.db.prepare("SELECT scope_state FROM inbox_message WHERE ns=? AND gmail_id=?").get(ns, gmailId) as { scope_state: string };
        if (r.scope_state === "deleted") return null;
        return { ...m, scopeState: r.scope_state as "active" | "archived", attachments: this.attachments(ns, gmailId) };
    }
    // Confirmed purge (D3/D9, R4) -------------------------------------------
    createPurgeToken(ns: string, tenant: string, owner: string, ttlMs: number): { confirmationId: string; expiresAt: number; revision: number } {
        const id = randomBytes(32).toString("hex"), expiresAt = this.now() + ttlMs;
        const revision = this.tx(() => {
            const n = this.namespaceInfo(ns);
            if (!n || n.tenant !== tenant || n.owner !== owner) throw new InboxStoreError("INBOX_NAMESPACE_NOT_OWNED");
            this.db.prepare("DELETE FROM inbox_purge_token WHERE expires_at < ? OR used=1").run(this.now());
            this.db.prepare("INSERT INTO inbox_purge_token VALUES(?,?,?,?,?,?,0)").run(createHash("sha256").update(id).digest("hex"), ns, tenant, owner, n.revision, expiresAt);
            return n.revision;
        });
        return { confirmationId: id, expiresAt, revision };
    }
    /** Single transaction: token valid, unused, unexpired, owned, same revision, no active lease → purge and pause. */
    purgeConfirmed(confirmationId: string, ns: string, tenant: string, owner: string) {
        if (typeof confirmationId !== "string" || !/^[a-f0-9]{64}$/.test(confirmationId)) throw new InboxStoreError("INBOX_PURGE_CONFIRMATION_INVALID");
        const hash = createHash("sha256").update(confirmationId).digest("hex");
        this.tx(() => {
            const tk = this.db.prepare("SELECT * FROM inbox_purge_token WHERE token_hash=?").get(hash) as Record<string, unknown> | undefined;
            if (!tk || tk.used === 1 || (tk.expires_at as number) < this.now() || tk.ns !== ns || tk.tenant !== tenant || tk.owner !== owner)
                throw new InboxStoreError("INBOX_PURGE_CONFIRMATION_INVALID");
            const n = this.namespaceInfo(ns);
            if (!n || n.tenant !== tenant || n.owner !== owner) throw new InboxStoreError("INBOX_NAMESPACE_NOT_OWNED");
            if (n.revision !== tk.revision) throw new InboxStoreError("INBOX_PURGE_CONFIRMATION_STALE");
            this.assertNoActiveLease(ns);
            this.db.prepare("UPDATE inbox_purge_token SET used=1 WHERE token_hash=?").run(hash);
            this.purgeRows(ns, true);
        });
    }
    close() {
        this.db.close();
    }
}

export interface InboxNamespaceInfo extends InboxNamespace {
    accountRef: string;
    revision: number;
    resyncRequired: boolean;
    autoSyncPaused: boolean;
    windowStartMs: number | null;
    lastSyncAt: number | null;
    nextSyncAt: number | null;
    backoffMs: number;
    messageCount: number;
    incrementalActive: boolean;
    fullRunActive: boolean;
}
export interface IncrementalRun {
    startHistory: string;
    targetHistory: string | null;
    phase: "list" | "reconcile";
    pageToken: string | null;
    pages: number;
    listRestarts: number;
    startedAt: number;
    pending: number;
    touched: number;
}
export type StateDecision =
    | { kind: "delete"; labels?: string[] }
    | { kind: "archive"; labels: string[] }
    | { kind: "labels"; labels: string[] }
    | { kind: "content"; message: MessageInput }
    /** Unknown message outside the imported window: not imported, only marked as processed. */
    | { kind: "skip" };
export type ListScope = "inbox" | "sent" | "archived";
export interface MessageSummary {
    gmailId: string;
    threadId: string | null;
    internalDate: number | null;
    labels: string[];
    from: string | null;
    to: string | null;
    subject: string | null;
    snippet: string | null;
    scopeState: "active" | "archived";
    bodySource: StoredMessage["bodySource"];
    attachmentCount: number;
}
