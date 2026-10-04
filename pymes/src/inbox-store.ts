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
export const INBOX_SCHEMA_VERSION = 2;
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
                this.db.prepare("UPDATE inbox_meta SET value=? WHERE key='schema_version'").run(String(INBOX_SCHEMA_VERSION));
            });
        }
        catch (error) {
            this.db.close();
            throw error;
        }
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
                .prepare("INSERT INTO inbox_namespace VALUES(?,?,?,?,?,NULL,'never',0,NULL,?,?) ON CONFLICT(ns) DO UPDATE SET account=excluded.account, updated_at=excluded.updated_at")
                .run(ns, tenant, owner, subject, account, t, t);
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
        body_truncated=excluded.body_truncated, size_estimate=excluded.size_estimate, deleted_at=NULL, updated_at=excluded.updated_at, quality_json=excluded.quality_json`);
            const delAtt = this.db.prepare("DELETE FROM inbox_attachment WHERE ns=? AND gmail_id=?");
            const insAtt = this.db.prepare("INSERT OR REPLACE INTO inbox_attachment VALUES(?,?,?,?,?,?)");
            const mark = this.db.prepare("UPDATE inbox_candidate SET fetched=1, outcome=? WHERE run_id=? AND gmail_id=?");
            for (const m of messages) {
                const p = m.parsed, h = p.headers;
                up.run(ns, m.gmailId, m.threadId, m.internalDate, JSON.stringify(m.labels), h.from, h.to, h.cc, h.replyTo, h.subject, h.date, h.messageId, h.inReplyTo, h.references, m.snippet, m.tooLarge ? "" : p.bodyText, m.tooLarge ? "too_large" : p.bodySource, m.tooLarge || p.bodyTruncated ? 1 : 0, m.sizeEstimate, t, t, JSON.stringify({ charsetFallback: p.charsetFallback, attachmentsTruncated: p.attachmentsTruncated, structureTruncated: p.structureTruncated, bodyUnavailable: m.tooLarge || p.bodyUnavailable }));
                delAtt.run(ns, m.gmailId);
                for (const a of p.attachments)
                    insAtt.run(ns, m.gmailId, a.partId, a.filename, a.mimeType, a.size);
                mark.run(null, runId, m.gmailId);
            }
            for (const s of skipped)
                mark.run(s.outcome, runId, s.gmailId);
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
                .prepare("UPDATE inbox_namespace SET history_id=?, sync_state=?, catchup_pending=1, last_error=NULL, updated_at=? WHERE ns=?")
                .run(run.h0, run.truncated ? "complete_truncated" : "complete_window", this.now(), ns);
            this.db.prepare("DELETE FROM inbox_candidate WHERE run_id=?").run(runId);
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
     * D3 contract for P04: deletes this namespace's synchronised inbox data and
     * cursor. Touches only this store (never CRM or runtime journal). Refuses
     * while a sync holds the lease.
     */
    purgeNamespace(ns: string) {
        this.tx(() => {
            const lease = this.db.prepare("SELECT expires_at FROM inbox_lease WHERE ns=?").get(ns) as {
                expires_at: number;
            } | undefined;
            if (lease && lease.expires_at >= this.now())
                throw new InboxStoreError("INBOX_SYNC_ACTIVE");
            for (const table of ["inbox_message", "inbox_attachment"])
                this.db.prepare(`DELETE FROM ${table} WHERE ns=?`).run(ns);
            this.db.prepare("DELETE FROM inbox_candidate WHERE run_id IN (SELECT run_id FROM inbox_full_run WHERE ns=?)").run(ns);
            this.db.prepare("DELETE FROM inbox_full_run WHERE ns=?").run(ns);
            this.db
                .prepare("UPDATE inbox_namespace SET history_id=NULL, sync_state='never', catchup_pending=0, last_error=NULL, updated_at=? WHERE ns=?")
                .run(this.now(), ns);
        });
    }
    close() {
        this.db.close();
    }
}
