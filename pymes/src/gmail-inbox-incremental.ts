import { GMAIL_READ_SCOPE, type GmailCredential } from "./gmail-oauth.js";
import { parseGmailPayload } from "./inbox-mime.js";
import { InboxStore, InboxStoreError, inboxNamespace, type MessageInput, type StateDecision } from "./inbox-store.js";
import type { InboxCredentialSource, InboxSyncOutcome } from "./gmail-inbox-sync.js";

/**
 * P04a — incremental catch-up (users.history.list) and post-resync local
 * reconciliation. GET only; no send capability.
 *
 * Progress is durable at every step: each validated history page stores its
 * touched ids and next page token; each message state application marks its
 * work item done in the same transaction. A small per-run budget therefore
 * always advances, and a SIGKILL resumes where it stopped. The cursor moves
 * only in finishIncremental(): CAS on the run's start history, after every
 * page was listed and every touched id reconciled.
 *
 * Reconciliation reads the current state of each id (labels + date
 * projection), so event order and duplicates do not matter:
 *   404 → tombstone (content removed) · SPAM/TRASH → tombstone ·
 *   neither INBOX nor SENT → archived (kept) · INBOX/SENT → active
 *   (body refetched if it had been removed; unknown ids imported only inside
 *   the window). Transport errors, 403, 429, 5xx or invalid JSON never count
 *   as absence.
 */
export interface GmailInboxIncrementalOptions {
  windowMs: number;
  historyPageSize: number;
  maxTouched: number;
  maxRequestsPerRun: number;
  batchSize: number;
  fullResponseMaxBytes: number;
  smallResponseMaxBytes: number;
  requestTimeoutMs: number;
  leaseTtlMs: number;
  maxListRestarts: number;
}
export const DEFAULT_INCREMENTAL_OPTIONS: GmailInboxIncrementalOptions = {
  windowMs: 90 * 86_400_000,
  historyPageSize: 500,
  maxTouched: 5000,
  maxRequestsPerRun: 300,
  batchSize: 25,
  fullResponseMaxBytes: 5_000_000,
  smallResponseMaxBytes: 1_000_000,
  requestTimeoutMs: 15_000,
  leaseTtlMs: 120_000,
  maxListRestarts: 3,
};
export interface IncrementalResult {
  outcome: InboxSyncOutcome;
  code: string | null;
  ns: string | null;
  requests: number;
  applied: number;
  /** History expired (404) or too many touched ids: a resync was recorded. */
  resyncRequired: boolean;
}
const API = "https://gmail.googleapis.com/gmail/v1/users/me/";
const GMAIL_ID = /^[-a-zA-Z0-9_]{1,100}$/;
const HISTORY_ID = /^[0-9]{1,40}$/;
const HISTORY_TYPES = ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"];
class Stop extends Error {
  constructor(readonly outcome: InboxSyncOutcome, code: string) {
    super(code);
  }
}
type Get = (path: string, max: number) => Promise<{ status: number; value: Record<string, unknown>; tooLarge?: boolean }>;

export class GmailInboxIncremental {
  private readonly o: GmailInboxIncrementalOptions;
  constructor(
    private oauth: InboxCredentialSource,
    private store: InboxStore,
    private scope: { tenant: string; owner: string },
    private fetcher: typeof fetch = fetch,
    options: Partial<GmailInboxIncrementalOptions> = {},
    private now: () => number = Date.now,
  ) {
    this.o = { ...DEFAULT_INCREMENTAL_OPTIONS, ...options };
    const limits: Record<keyof GmailInboxIncrementalOptions, [number, number]> = {
      windowMs: [1, 365 * 86_400_000], historyPageSize: [1, 500], maxTouched: [1, 100_000],
      maxRequestsPerRun: [4, 100_000], batchSize: [1, 200], fullResponseMaxBytes: [1, 10_000_000],
      smallResponseMaxBytes: [1, 2_000_000], requestTimeoutMs: [1, 120_000], leaseTtlMs: [1, 600_000], maxListRestarts: [0, 20],
    };
    for (const key of Object.keys(limits) as (keyof GmailInboxIncrementalOptions)[]) {
      const [min, max] = limits[key];
      if (!Number.isSafeInteger(this.o[key]) || this.o[key] < min || this.o[key] > max) throw new Error("INVALID_INBOX_INCREMENTAL_OPTIONS");
    }
    if (!scope.tenant || !scope.owner || scope.tenant.length > 200 || scope.owner.length > 200) throw new Error("INVALID_INBOX_SYNC_SCOPE");
    this.scope = { ...scope };
  }

  incremental(signal: AbortSignal = new AbortController().signal) {
    return this.session(signal, "incremental");
  }
  /** Reconciles the local snapshot taken at resync start, after the new full sync. */
  reconcileLocal(signal: AbortSignal = new AbortController().signal) {
    return this.session(signal, "local");
  }

  private async session(signal: AbortSignal, mode: "incremental" | "local"): Promise<IncrementalResult> {
    const result: IncrementalResult = { outcome: "failed", code: null, ns: null, requests: 0, applied: 0, resyncRequired: false };
    if (signal.aborted) return { ...result, outcome: "paused", code: "INBOX_SYNC_ABORTED" };
    let cred: GmailCredential;
    try {
      cred = await this.oauth.credential();
    } catch {
      return { ...result, outcome: "blocked", code: "GMAIL_NOT_CONNECTED" };
    }
    if (!cred.scopes.includes(GMAIL_READ_SCOPE)) return { ...result, outcome: "blocked", code: "GMAIL_READ_SCOPE_MISSING" };
    const subject = cred.subject, account = cred.account, generation = cred.generation;
    const ns = inboxNamespace(this.scope.tenant, this.scope.owner, subject);
    result.ns = ns;
    if (!this.store.namespace(ns)) return { ...result, code: "INBOX_NOT_INITIALISED" };
    const token = this.store.acquireLease(ns, this.o.leaseTtlMs);
    if (!token) return { ...result, outcome: "busy", code: "INBOX_SYNC_ACTIVE" };
    const live = async () => {
      signal.throwIfAborted();
      let c: GmailCredential;
      try {
        c = await this.oauth.credential();
      } catch {
        throw new Stop("blocked", "GMAIL_NOT_CONNECTED");
      }
      if (c.subject !== subject || c.account !== account) throw new Stop("blocked", "GMAIL_ACCOUNT_CHANGED");
      if (c.generation !== generation) throw new Stop("blocked", "GMAIL_AUTHORIZATION_CHANGED");
      if (!c.scopes.includes(GMAIL_READ_SCOPE)) throw new Stop("blocked", "GMAIL_READ_SCOPE_MISSING");
      cred = c;
      this.store.renewLease(ns, token, this.o.leaseTtlMs);
    };
    const get: Get = async (path, max) => {
      if (result.requests >= this.o.maxRequestsPerRun) throw new Stop("paused", "INBOX_RUN_BUDGET_REACHED");
      result.requests++;
      await live();
      const response = await this.getJson(path, cred.accessToken, max, signal);
      if (response.tooLarge && !path.includes("format=full&") && !/format=full$/.test(path)) throw new Stop("failed", "GMAIL_RESPONSE_TOO_LARGE");
      return response;
    };
    try {
      if (mode === "incremental") await this.runIncremental(ns, token, get, live, result);
      else await this.runLocal(ns, token, get, live, result);
      if (!result.resyncRequired) result.outcome = "complete";
      return result;
    } catch (error) {
      const stop = error instanceof Stop ? error
        : error instanceof InboxStoreError ? new Stop("failed", error.message)
        : signal.aborted ? new Stop("paused", "INBOX_SYNC_ABORTED")
        : new Stop("failed", "INBOX_SYNC_FAILED");
      try {
        this.store.setNamespaceError(ns, token, stop.message);
      } catch {}
      return { ...result, outcome: stop.outcome, code: stop.message };
    } finally {
      try {
        this.store.releaseLease(ns, token);
      } catch {}
    }
  }

  private async runIncremental(ns: string, token: string, get: Get, live: () => Promise<void>, result: IncrementalResult) {
    let run = this.store.incrementalRun(ns) ?? this.store.startIncremental(ns, token);
    while (run.phase === "list") {
      const q = new URLSearchParams({ startHistoryId: run.startHistory, maxResults: String(this.o.historyPageSize) });
      for (const type of HISTORY_TYPES) q.append("historyTypes", type);
      if (run.pageToken) q.set("pageToken", run.pageToken);
      const r = await get("history?" + q, this.o.smallResponseMaxBytes);
      if (r.status === 404) {
        await live();
        this.store.startResync(ns, token);
        result.resyncRequired = true;
        result.outcome = "paused";
        result.code = "INBOX_RESYNC_REQUIRED";
        return;
      }
      if (r.status === 400 && run.pageToken) {
        await live();
        if (this.store.restartIncrementalListing(ns, token) > this.o.maxListRestarts) throw new Stop("failed", "GMAIL_HISTORY_PAGINATION_INVALID");
        run = this.store.incrementalRun(ns)!;
        continue;
      }
      if (r.status !== 200) throw this.httpStop(r.status);
      const page = this.parseHistoryPage(r.value);
      await live();
      const state = this.store.recordHistoryPage(ns, token, page, this.o.maxTouched);
      if (state === "overflow") {
        this.store.startResync(ns, token);
        result.resyncRequired = true;
        result.outcome = "paused";
        result.code = "INBOX_RESYNC_REQUIRED";
        return;
      }
      run = this.store.incrementalRun(ns)!;
    }
    const windowStart = this.windowStart(ns);
    let batch: string[];
    while ((batch = this.store.touchedPending(ns, this.o.batchSize)).length)
      for (const id of batch) {
        await this.reconcileOne(ns, token, id, { touched: true }, windowStart, get, live);
        result.applied++;
      }
    await live();
    this.store.finishIncremental(ns, token);
  }

  private async runLocal(ns: string, token: string, get: Get, live: () => Promise<void>, result: IncrementalResult) {
    const resync = this.store.resyncActive(ns);
    if (!resync) return;
    if (!resync.fullDone || this.store.activeRun(ns) || !this.store.namespace(ns)?.historyId) throw new Stop("failed", "INBOX_RESYNC_FULL_SYNC_PENDING");
    const windowStart = this.windowStart(ns);
    let batch: string[];
    while ((batch = this.store.resyncPending(ns, this.o.batchSize)).length)
      for (const id of batch) {
        await this.reconcileOne(ns, token, id, { resync: true }, windowStart, get, live);
        result.applied++;
      }
    await live();
    this.store.finishResync(ns, token);
  }

  private windowStart(ns: string) {
    return this.store.namespaceInfo(ns)?.windowStartMs ?? this.now() - this.o.windowMs;
  }

  private async reconcileOne(ns: string, token: string, id: string, work: { touched?: boolean; resync?: boolean }, windowStart: number, get: Get, live: () => Promise<void>) {
    if (!GMAIL_ID.test(id)) throw new Stop("failed", "GMAIL_HISTORY_INVALID");
    const r = await get(`messages/${id}?format=full&fields=id,labelIds,internalDate`, this.o.smallResponseMaxBytes);
    let decision: StateDecision;
    if (r.status === 404) decision = { kind: "delete" };
    else if (r.status !== 200) throw this.httpStop(r.status);
    else {
      if (r.value.id !== id) throw new Stop("failed", "GMAIL_MESSAGE_INVALID");
      const labels = this.labels(r.value.labelIds), date = this.date(r.value.internalDate);
      const local = this.store.localState(ns, id);
      if (labels.includes("SPAM") || labels.includes("TRASH")) decision = { kind: "delete", labels };
      else if (!labels.includes("INBOX") && !labels.includes("SENT")) decision = local ? { kind: "archive", labels } : { kind: "skip" };
      else if (local && local.scopeState !== "deleted") decision = { kind: "labels", labels };
      else if (local || date >= windowStart) {
        // A removed body comes back when the message returns, even if older than the window.
        const content = await this.fetchContent(id, get);
        decision = content === "gone" ? { kind: "delete" } : content === "out_of_scope" ? (local ? { kind: "delete" } : { kind: "skip" }) : { kind: "content", message: content };
      } else decision = { kind: "skip" };
    }
    await live();
    this.store.applyState(ns, token, id, decision, work);
  }

  private async fetchContent(id: string, get: Get): Promise<MessageInput | "gone" | "out_of_scope"> {
    let r = await get(`messages/${id}?format=full`, this.o.fullResponseMaxBytes), tooLarge = false;
    if (r.tooLarge && r.status === 200) {
      tooLarge = true;
      const q = new URLSearchParams({ format: "metadata" });
      for (const h of ["From", "To", "Cc", "Reply-To", "Subject", "Date", "Message-ID", "In-Reply-To", "References"]) q.append("metadataHeaders", h);
      r = await get(`messages/${id}?${q}`, this.o.smallResponseMaxBytes);
      if (r.tooLarge) throw new Stop("failed", "GMAIL_MESSAGE_TOO_LARGE");
    }
    if (r.status === 404) return "gone";
    if (r.status !== 200) throw this.httpStop(r.status);
    const v = r.value;
    if (v.id !== id) throw new Stop("failed", "GMAIL_MESSAGE_INVALID");
    const labels = this.labels(v.labelIds);
    if (labels.includes("SPAM") || labels.includes("TRASH") || (!labels.includes("INBOX") && !labels.includes("SENT"))) return "out_of_scope";
    if (!v.payload || typeof v.payload !== "object" || Array.isArray(v.payload)) throw new Stop("failed", "GMAIL_MESSAGE_INVALID");
    const size = Number(v.sizeEstimate);
    return {
      gmailId: id,
      threadId: typeof v.threadId === "string" && GMAIL_ID.test(v.threadId) ? v.threadId : null,
      internalDate: this.date(v.internalDate),
      labels,
      snippet: typeof v.snippet === "string" ? v.snippet.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500) : null,
      sizeEstimate: Number.isSafeInteger(size) && size >= 0 ? size : null,
      parsed: parseGmailPayload(v.payload),
      tooLarge,
    };
  }

  /** Validates one history page. historyId is an opaque decimal string, never arithmetic. */
  private parseHistoryPage(v: Record<string, unknown>) {
    const historyId = v.historyId;
    if (typeof historyId !== "string" || !HISTORY_ID.test(historyId)) throw new Stop("failed", "GMAIL_HISTORY_INVALID");
    const history = v.history === undefined ? [] : v.history;
    if (!Array.isArray(history) || history.length > this.o.historyPageSize) throw new Stop("failed", "GMAIL_HISTORY_INVALID");
    const ids = new Set<string>();
    const take = (m: unknown) => {
      const id = m && typeof m === "object" ? (m as { id?: unknown }).id : undefined;
      if (typeof id !== "string" || !GMAIL_ID.test(id)) throw new Stop("failed", "GMAIL_HISTORY_INVALID");
      ids.add(id);
    };
    for (const record of history) {
      if (!record || typeof record !== "object" || Array.isArray(record)) throw new Stop("failed", "GMAIL_HISTORY_INVALID");
      const rec = record as Record<string, unknown>;
      if (rec.id !== undefined && (typeof rec.id !== "string" || !HISTORY_ID.test(rec.id))) throw new Stop("failed", "GMAIL_HISTORY_INVALID");
      for (const key of ["messages", "messagesAdded", "messagesDeleted", "labelsAdded", "labelsRemoved"]) {
        const list = rec[key];
        if (list === undefined) continue;
        if (!Array.isArray(list) || list.length > 1000) throw new Stop("failed", "GMAIL_HISTORY_INVALID");
        for (const item of list) take(key === "messages" ? item : item && typeof item === "object" ? (item as { message?: unknown }).message : undefined);
      }
    }
    const next = v.nextPageToken;
    if (next !== undefined && next !== null && next !== "" && (typeof next !== "string" || next.length > 1024)) throw new Stop("failed", "GMAIL_HISTORY_INVALID");
    return { ids: [...ids], nextPageToken: typeof next === "string" && next ? next : null, historyId };
  }
  private date(value: unknown) {
    if (typeof value !== "string" || !/^[0-9]{1,16}$/.test(value)) throw new Stop("failed", "GMAIL_MESSAGE_INVALID");
    const d = Number(value);
    if (!Number.isSafeInteger(d)) throw new Stop("failed", "GMAIL_MESSAGE_INVALID");
    return d;
  }
  private labels(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > 1000 || value.some(l => typeof l !== "string" || !l || l.length > 100)) throw new Stop("failed", "GMAIL_MESSAGE_INVALID");
    return [...new Set(value as string[])];
  }
  private httpStop(status: number) {
    if (status === 401 || status === 403) return new Stop("blocked", "GMAIL_AUTHORIZATION_REQUIRED");
    if (status === 429) return new Stop("paused", "GMAIL_RATE_LIMITED");
    if (status >= 500) return new Stop("paused", "GMAIL_UNAVAILABLE");
    return new Stop("failed", "GMAIL_HTTP_" + (Number.isInteger(status) ? status : "ERR"));
  }
  /** Same bounded GET contract as P03's full sync. Never logs. */
  private async getJson(path: string, accessToken: string, maxBytes: number, signal: AbortSignal) {
    let response: Response;
    try {
      response = await this.fetcher(API + path, {
        method: "GET",
        headers: { Authorization: "Bearer " + accessToken },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.o.requestTimeoutMs)]),
      });
    } catch {
      throw new Stop("paused", signal.aborted ? "INBOX_SYNC_ABORTED" : "GMAIL_REQUEST_FAILED");
    }
    const declared = Number(response.headers.get("content-length"));
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0, tooLarge = Number.isFinite(declared) && declared > maxBytes;
    if (reader) {
      try {
        while (!tooLarge) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > maxBytes) tooLarge = true;
          else chunks.push(part.value);
        }
      } catch {
        throw new Stop("paused", signal.aborted ? "INBOX_SYNC_ABORTED" : "GMAIL_REQUEST_FAILED");
      } finally {
        await reader.cancel().catch(() => {});
      }
    }
    if (tooLarge) return { status: response.status, value: {} as Record<string, unknown>, tooLarge: true };
    let value: unknown;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      if (response.status === 200) throw new Stop("failed", "GMAIL_RESPONSE_INVALID");
      value = {};
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      if (response.status === 200) throw new Stop("failed", "GMAIL_RESPONSE_INVALID");
      value = {};
    }
    return { status: response.status, value: value as Record<string, unknown> };
  }
}
