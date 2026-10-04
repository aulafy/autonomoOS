import { GMAIL_READ_SCOPE, type GmailCredential } from "./gmail-oauth.js";
import { parseGmailPayload } from "./inbox-mime.js";
import { InboxStore, InboxStoreError, type FullRun, type MessageInput } from "./inbox-store.js";
/**
 * P03 — read-only Gmail full sync into InboxStore.
 *
 * GET only. Does not import or call the send provider; it holds no send
 * capability. Credentials come from the existing GmailOAuth (Keychain) via a
 * minimal interface. Incoming mail is stored as data and never influences
 * policies, approvals or configuration.
 *
 * Selection (D1/D2): messages labelled INBOX or SENT (union of two listings,
 * includeSpamTrash=false) with q=after:<window start>, window = 90 days before
 * H0 capture. If the window holds more than `selectionCap` (2,000) messages,
 * the selection is the `selectionCap` messages with the greatest internalDate
 * (ties by id), computed from projected format=full for every candidate — not from
 * the unspecified order of messages.list. The rest of the window is not
 * imported and the namespace records `complete_truncated`.
 *
 * Budgets: the selection limit (D1) is a product rule; `maxRequestsPerRun` is
 * a per-invocation budget. Exceeding the budget pauses the run durably; the
 * next invocation resumes the same run (same H0, window and selection). The
 * cursor (H0) is confirmed only when every selected message is stored. After
 * that the namespace stays `catchupPending` until P04's incremental sync.
 */
export interface InboxCredentialSource {
    credential(): Promise<GmailCredential>;
}
export interface GmailInboxSyncOptions {
    windowMs: number;
    selectionCap: number;
    /** Hard cap on enumerated ids across both labels; above it the run blocks. */
    maxCandidates: number;
    listPageSize: number;
    maxRequestsPerRun: number;
    batchSize: number;
    fullResponseMaxBytes: number;
    smallResponseMaxBytes: number;
    requestTimeoutMs: number;
    leaseTtlMs: number;
    /** Restart older runs; P04 must still handle history expiry independently. */
    maxRunAgeMs: number;
}
export const DEFAULT_INBOX_SYNC_OPTIONS: GmailInboxSyncOptions = {
    windowMs: 90 * 86400000,
    selectionCap: 2000,
    maxCandidates: 20000,
    listPageSize: 500,
    maxRequestsPerRun: 600,
    batchSize: 25,
    fullResponseMaxBytes: 5000000,
    smallResponseMaxBytes: 1000000,
    requestTimeoutMs: 15000,
    leaseTtlMs: 120000,
    maxRunAgeMs: 5 * 86400000,
};
export type InboxSyncOutcome = "complete" | "paused" | "busy" | "blocked" | "failed";
export interface InboxSyncResult {
    outcome: InboxSyncOutcome;
    /** Sanitised code; never contains tokens, bodies or addresses. */
    code: string | null;
    ns: string | null;
    runId: string | null;
    requests: number;
    stored: number;
    truncated: boolean;
}
const API = "https://gmail.googleapis.com/gmail/v1/users/me/";
const GMAIL_ID = /^[-a-zA-Z0-9_]{1,100}$/;
const HISTORY_ID = /^[0-9]{1,40}$/;
const LABELS = ["INBOX", "SENT"] as const;
class SyncStop extends Error {
    constructor(readonly outcome: InboxSyncOutcome, code: string) {
        super(code);
    }
}
export class GmailInboxSync {
    private readonly o: GmailInboxSyncOptions;
    constructor(private oauth: InboxCredentialSource, private store: InboxStore, private scope: {
        tenant: string;
        owner: string;
    }, private fetcher: typeof fetch = fetch, options: Partial<GmailInboxSyncOptions> = {}, private now: () => number = Date.now) {
        this.o = { ...DEFAULT_INBOX_SYNC_OPTIONS, ...options };
        const limits: Record<keyof GmailInboxSyncOptions, number> = {
            windowMs: 365 * 86400000, selectionCap: 20000, maxCandidates: 100000,
            listPageSize: 500, maxRequestsPerRun: 100000, batchSize: 200,
            fullResponseMaxBytes: 10000000, smallResponseMaxBytes: 2000000,
            requestTimeoutMs: 120000, leaseTtlMs: 600000, maxRunAgeMs: 30 * 86400000,
        };
        for (const key of Object.keys(limits) as (keyof GmailInboxSyncOptions)[])
            if (!Number.isSafeInteger(this.o[key]) || this.o[key] < 1 || this.o[key] > limits[key])
                throw new Error("INVALID_INBOX_SYNC_OPTIONS");
        if (!scope.tenant || !scope.owner || scope.tenant.length > 200 || scope.owner.length > 200)
            throw new Error("INVALID_INBOX_SYNC_SCOPE");
        this.scope = { ...scope };
        const enumerationRequests = LABELS.length * (Math.ceil(this.o.maxCandidates / this.o.listPageSize) + 1) + 1;
        // Enumeration is not resumable mid-way, so one invocation must be able to finish it.
        if (this.o.selectionCap < 1 ||
            this.o.maxCandidates < this.o.selectionCap ||
            this.o.listPageSize < 1 ||
            this.o.listPageSize > 500 ||
            this.o.batchSize < 1 ||
            this.o.maxRequestsPerRun < enumerationRequests + 1)
            throw new Error("INVALID_INBOX_SYNC_OPTIONS");
    }
    async fullSync(signal: AbortSignal = new AbortController().signal): Promise<InboxSyncResult> {
        const result: InboxSyncResult = { outcome: "failed", code: null, ns: null, runId: null, requests: 0, stored: 0, truncated: false };
        if (signal.aborted)
            return { ...result, outcome: "paused", code: "INBOX_SYNC_ABORTED" };
        let cred: GmailCredential;
        try {
            cred = await this.oauth.credential();
        }
        catch {
            return { ...result, outcome: "blocked", code: "GMAIL_NOT_CONNECTED" };
        }
        if (!cred.scopes.includes(GMAIL_READ_SCOPE))
            return { ...result, outcome: "blocked", code: "GMAIL_READ_SCOPE_MISSING" };
        if (signal.aborted)
            return { ...result, outcome: "paused", code: "INBOX_SYNC_ABORTED" };
        const subject = cred.subject, generation = cred.generation;
        const nsRow = this.store.ensureNamespace(this.scope.tenant, this.scope.owner, subject, cred.account);
        const ns = nsRow.ns;
        result.ns = ns;
        const token = this.store.acquireLease(ns, this.o.leaseTtlMs);
        if (!token)
            return { ...result, outcome: "busy", code: "INBOX_SYNC_ACTIVE" };
        let run: FullRun | null = null;
        // Re-validates connection and account before every durable write.
        const live = async () => {
            signal.throwIfAborted();
            let c: GmailCredential;
            try {
                c = await this.oauth.credential();
            }
            catch {
                throw new SyncStop("blocked", "GMAIL_NOT_CONNECTED");
            }
            if (c.subject !== subject || c.account !== cred.account)
                throw new SyncStop("blocked", "GMAIL_ACCOUNT_CHANGED");
            if (c.generation !== generation)
                throw new SyncStop("blocked", "GMAIL_AUTHORIZATION_CHANGED");
            if (!c.scopes.includes(GMAIL_READ_SCOPE))
                throw new SyncStop("blocked", "GMAIL_READ_SCOPE_MISSING");
            cred = c;
            this.store.renewLease(ns, token, this.o.leaseTtlMs);
        };
        const get = async (path: string, maxBytes: number) => {
            if (result.requests >= this.o.maxRequestsPerRun)
                throw new SyncStop("paused", "INBOX_RUN_BUDGET_REACHED");
            result.requests++;
            // Revalidate the binding and renew before each GET as well as each publication.
            await live();
            const response = await this.getJson(path, cred.accessToken, maxBytes, signal);
            if (response.tooLarge && !path.includes("format=full"))
                throw new SyncStop("failed", "GMAIL_RESPONSE_TOO_LARGE");
            return response;
        };
        try {
            run = this.store.activeRun(ns);
            if (run && this.now() - run.startedAt > this.o.maxRunAgeMs) {
                this.store.abandonRun(ns, token, run.runId);
                run = null;
            }
            if (!run) {
                // H0 before enumeration: changes during the sync belong to P04's catch-up.
                const profile = await get("profile", this.o.smallResponseMaxBytes);
                const h0 = profile.value.historyId;
                if (profile.status !== 200)
                    throw this.httpStop(profile.status);
                if (typeof h0 !== "string" || !HISTORY_ID.test(h0))
                    throw new SyncStop("failed", "GMAIL_PROFILE_INVALID");
                if (typeof profile.value.emailAddress !== "string" || profile.value.emailAddress.toLowerCase() !== cred.account.toLowerCase())
                    throw new SyncStop("blocked", "GMAIL_ACCOUNT_CHANGED");
                await live();
                run = this.store.createRun(ns, token, h0, this.now() - this.o.windowMs);
            }
            result.runId = run.runId;
            if (run.phase === "enumerate") {
                const ids = new Set<string>();
                for (const label of LABELS) {
                    let pageToken: string | null = null, pages = 0;
                    const seenTokens = new Set<string>(), seenIds = new Set<string>();
                    do {
                        if (++pages > Math.ceil(this.o.maxCandidates / this.o.listPageSize) + 1)
                            throw new SyncStop("blocked", "INBOX_ENUMERATION_LIMIT");
                        const q = new URLSearchParams({
                            labelIds: label,
                            q: "after:" + Math.floor(run.windowStartMs / 1000),
                            maxResults: String(this.o.listPageSize),
                            includeSpamTrash: "false",
                        });
                        if (pageToken)
                            q.set("pageToken", pageToken);
                        const r = await get("messages?" + q, this.o.smallResponseMaxBytes);
                        if (r.status !== 200)
                            throw this.httpStop(r.status);
                        if (r.value.messages === undefined && r.value.resultSizeEstimate !== 0)
                            throw new SyncStop("failed", "GMAIL_LIST_INVALID");
                        const list = r.value.messages ?? [];
                        if (!Array.isArray(list) || list.length > this.o.listPageSize)
                            throw new SyncStop("failed", "GMAIL_LIST_INVALID");
                        for (const m of list) {
                            const id = m && typeof m === "object" ? (m as {
                                id?: unknown;
                            }).id : null;
                            if (typeof id !== "string" || !GMAIL_ID.test(id))
                                throw new SyncStop("failed", "GMAIL_LIST_INVALID");
                            if (seenIds.has(id))
                                throw new SyncStop("failed", "GMAIL_PAGINATION_INVALID");
                            seenIds.add(id);
                            ids.add(id);
                        }
                        if (ids.size > this.o.maxCandidates)
                            throw new SyncStop("blocked", "INBOX_ENUMERATION_LIMIT");
                        const next = r.value.nextPageToken;
                        if (next !== undefined && next !== null && next !== "" && (typeof next !== "string" || next.length > 1024))
                            throw new SyncStop("failed", "GMAIL_LIST_INVALID");
                        if (typeof next === "string" && next) {
                            if (seenTokens.has(next))
                                throw new SyncStop("failed", "GMAIL_PAGINATION_INVALID");
                            seenTokens.add(next);
                        }
                        pageToken = typeof next === "string" && next ? next : null;
                    } while (pageToken);
                }
                await live();
                this.store.finishEnumeration(ns, token, run.runId, ids);
                run = this.store.run(run.runId)!;
            }
            if (run.phase === "select") {
                if (run.candidates > this.o.selectionCap) {
                    // Dates for every candidate: selection must not rely on list order.
                    let batch: string[];
                    while ((batch = this.store.candidatesNeedingDate(run.runId, this.o.batchSize)).length) {
                        const dated: {
                            id: string;
                            date: number | null;
                            outcome: string | null;
                        }[] = [];
                        const saveDates = async () => {
                            await live();
                            for (const d of dated)
                                this.store.recordCandidateDate(ns, token, run!.runId, d.id, d.date, d.outcome);
                        };
                        try {
                            for (const id of batch) {
                                const r = await get(`messages/${id}?format=full&fields=id,labelIds,internalDate`, this.o.smallResponseMaxBytes);
                                if (r.status === 404)
                                    dated.push({ id, date: null, outcome: "gone" });
                                else if (r.status !== 200)
                                    throw this.httpStop(r.status);
                                else {
                                    const d = this.messageDate(r.value.internalDate);
                                    if (r.value.id !== id)
                                        throw new SyncStop("failed", "GMAIL_MESSAGE_INVALID");
                                    const labels = this.messageLabels(r.value.labelIds);
                                    const inScope = labels.some((l) => l === "INBOX" || l === "SENT") && !labels.some((l) => l === "SPAM" || l === "TRASH");
                                    if (!Number.isSafeInteger(d))
                                        throw new SyncStop("failed", "GMAIL_MESSAGE_INVALID");
                                    dated.push({ id, date: d, outcome: inScope && d >= run.windowStartMs ? null : "out_of_scope" });
                                }
                            }
                        }
                        catch (error) {
                            if (error instanceof SyncStop && error.message === "INBOX_RUN_BUDGET_REACHED" && dated.length)
                                await saveDates();
                            throw error;
                        }
                        await saveDates();
                    }
                }
                await live();
                this.store.select(ns, token, run.runId, this.o.selectionCap);
                run = this.store.run(run.runId)!;
            }
            result.truncated = run.truncated;
            if (run.phase === "fetch") {
                let batch: string[];
                while ((batch = this.store.selectedToFetch(run.runId, this.o.batchSize)).length) {
                    const messages: MessageInput[] = [], skipped: {
                        gmailId: string;
                        outcome: string;
                    }[] = [];
                    const saveMessages = async () => {
                        await live();
                        this.store.writeBatch(ns, token, run!.runId, messages, skipped);
                        result.stored += messages.length;
                    };
                    try {
                        for (const id of batch) {
                            const m = await this.fetchMessage(id, get, run.windowStartMs);
                            if (m === "gone" || m === "out_of_scope")
                                skipped.push({ gmailId: id, outcome: m });
                            else
                                messages.push(m);
                        }
                    }
                    catch (error) {
                        if (error instanceof SyncStop && error.message === "INBOX_RUN_BUDGET_REACHED" && (messages.length || skipped.length))
                            await saveMessages();
                        throw error;
                    }
                    await saveMessages();
                }
                await live();
                this.store.completeRun(ns, token, run.runId);
            }
            return { ...result, outcome: "complete" };
        }
        catch (error) {
            const stop = error instanceof SyncStop
                ? error
                : error instanceof InboxStoreError
                    ? new SyncStop("failed", error.message)
                    : signal.aborted
                        ? new SyncStop("paused", "INBOX_SYNC_ABORTED")
                        : new SyncStop("failed", "INBOX_SYNC_FAILED");
            try {
                this.store.setNamespaceError(ns, token, stop.message, stop.outcome === "blocked" ? "blocked" : undefined);
            }
            catch { }
            return { ...result, outcome: stop.outcome, code: stop.message };
        }
        finally {
            try {
                this.store.releaseLease(ns, token);
            }
            catch { }
        }
    }
    private async fetchMessage(id: string, get: (path: string, max: number) => Promise<{
        status: number;
        value: Record<string, unknown>;
        tooLarge?: boolean;
    }>, windowStartMs: number): Promise<MessageInput | "gone" | "out_of_scope"> {
        let r = await get(`messages/${id}?format=full`, this.o.fullResponseMaxBytes);
        let tooLarge = false;
        if (r.tooLarge && r.status === 200) {
            tooLarge = true;
            const q = new URLSearchParams({ format: "metadata" });
            for (const h of ["From", "To", "Cc", "Reply-To", "Subject", "Date", "Message-ID", "In-Reply-To", "References"])
                q.append("metadataHeaders", h);
            r = await get(`messages/${id}?${q}`, this.o.smallResponseMaxBytes);
            if (r.tooLarge)
                throw new SyncStop("failed", "GMAIL_MESSAGE_TOO_LARGE");
        }
        if (r.status === 404)
            return "gone";
        if (r.status !== 200)
            throw this.httpStop(r.status);
        const v = r.value;
        if (v.id !== id)
            throw new SyncStop("failed", "GMAIL_MESSAGE_INVALID");
        const labels = this.messageLabels(v.labelIds);
        if (!labels.some((l) => l === "INBOX" || l === "SENT") || labels.some((l) => l === "SPAM" || l === "TRASH"))
            return "out_of_scope";
        const internalDate = this.messageDate(v.internalDate);
        if (internalDate < windowStartMs)
            return "out_of_scope";
        if (!v.payload || typeof v.payload !== "object" || Array.isArray(v.payload))
            throw new SyncStop("failed", "GMAIL_MESSAGE_INVALID");
        const size = Number(v.sizeEstimate);
        return {
            gmailId: id,
            threadId: typeof v.threadId === "string" && GMAIL_ID.test(v.threadId) ? v.threadId : null,
            internalDate: Number.isSafeInteger(internalDate) ? internalDate : null,
            labels,
            snippet: typeof v.snippet === "string" ? v.snippet.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500) : null,
            sizeEstimate: Number.isSafeInteger(size) && size >= 0 ? size : null,
            parsed: parseGmailPayload(v.payload),
            tooLarge,
        };
    }
    private messageDate(value: unknown): number {
        if (typeof value !== "string" || !/^[0-9]{1,16}$/.test(value))
            throw new SyncStop("failed", "GMAIL_MESSAGE_INVALID");
        const date = Number(value);
        if (!Number.isSafeInteger(date) || date < 0 || date > 8640000000000000)
            throw new SyncStop("failed", "GMAIL_MESSAGE_INVALID");
        return date;
    }
    private messageLabels(value: unknown): string[] {
        if (!Array.isArray(value) || value.length > 1000 || value.some(l => typeof l !== "string" || !l || l.length > 100))
            throw new SyncStop("failed", "GMAIL_MESSAGE_INVALID");
        return [...new Set(value)] as string[];
    }
    private httpStop(status: number) {
        if (status === 401 || status === 403)
            return new SyncStop("blocked", "GMAIL_AUTHORIZATION_REQUIRED");
        if (status === 429)
            return new SyncStop("paused", "GMAIL_RATE_LIMITED");
        if (status >= 500)
            return new SyncStop("paused", "GMAIL_UNAVAILABLE");
        return new SyncStop("failed", "GMAIL_HTTP_" + (Number.isInteger(status) ? status : "ERR"));
    }
    /** GET with a byte cap. Never logs; errors are reduced to fixed codes. */
    private async getJson(path: string, accessToken: string, maxBytes: number, signal: AbortSignal) {
        let response: Response;
        try {
            response = await this.fetcher(API + path, {
                method: "GET",
                headers: { Authorization: "Bearer " + accessToken },
                redirect: "error",
                signal: AbortSignal.any([signal, AbortSignal.timeout(this.o.requestTimeoutMs)]),
            });
        }
        catch {
            if (signal.aborted)
                throw new SyncStop("paused", "INBOX_SYNC_ABORTED");
            throw new SyncStop("paused", "GMAIL_REQUEST_FAILED");
        }
        const declared = Number(response.headers.get("content-length"));
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0, tooLarge = Number.isFinite(declared) && declared > maxBytes;
        if (reader) {
            try {
                while (!tooLarge) {
                    const part = await reader.read();
                    if (part.done)
                        break;
                    bytes += part.value.byteLength;
                    if (bytes > maxBytes)
                        tooLarge = true;
                    else
                        chunks.push(part.value);
                }
            }
            catch {
                throw new SyncStop("paused", signal.aborted ? "INBOX_SYNC_ABORTED" : "GMAIL_REQUEST_FAILED");
            }
            finally {
                await reader.cancel().catch(() => { });
            }
        }
        if (tooLarge)
            return { status: response.status, value: {} as Record<string, unknown>, tooLarge: true };
        let value: unknown = {};
        try {
            value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        }
        catch {
            if (response.status === 200)
                throw new SyncStop("failed", "GMAIL_RESPONSE_INVALID");
            value = {};
        }
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            if (response.status === 200)
                throw new SyncStop("failed", "GMAIL_RESPONSE_INVALID");
            value = {};
        }
        return { status: response.status, value: value as Record<string, unknown> };
    }
}
