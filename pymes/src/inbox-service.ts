import { GMAIL_READ_SCOPE } from "./gmail-oauth.js";
import { createHash } from "node:crypto";
import { GmailInboxSync, type GmailInboxSyncOptions, type InboxCredentialSource, type InboxSyncOutcome } from "./gmail-inbox-sync.js";
import { GmailInboxIncremental, type GmailInboxIncrementalOptions } from "./gmail-inbox-incremental.js";
import { InboxStore, InboxStoreError, inboxNamespace, type InboxNamespaceInfo } from "./inbox-store.js";

/**
 * P04a — one Gmail inbox sync service per pilot process (one configured owner).
 *
 * Single flight inside the process; the store lease protects against other
 * processes. Automatic ticks run every 5 minutes only while the account is
 * connected with gmail.readonly, never while a purge pause is set, and wait
 * for the durable backoff after 429/5xx/transport errors (up to 30 minutes).
 * An authorization block waits for a different credential generation.
 * cancel() aborts and awaits the running step. Incoming mail never affects
 * policies, approvals or configuration.
 */
export interface InboxServiceOptions {
  intervalMs: number;
  minBackoffMs: number;
  maxBackoffMs: number;
  maxStepsPerRun: number;
  purgeConfirmationTtlMs: number;
  sync: Partial<GmailInboxSyncOptions>;
  incremental: Partial<GmailInboxIncrementalOptions>;
}
export const DEFAULT_INBOX_SERVICE_OPTIONS: InboxServiceOptions = {
  intervalMs: 5 * 60_000,
  minBackoffMs: 60_000,
  maxBackoffMs: 30 * 60_000,
  maxStepsPerRun: 4,
  purgeConfirmationTtlMs: 5 * 60_000,
  sync: {},
  incremental: {},
};
export type ErrorCategory = "auth" | "limit" | "budget" | "backoff" | "busy" | "data";
export function errorCategory(code: string | null): ErrorCategory | null {
  if (!code) return null;
  if (["GMAIL_AUTHORIZATION_REQUIRED", "GMAIL_NOT_CONNECTED", "GMAIL_READ_SCOPE_MISSING", "GMAIL_ACCOUNT_CHANGED", "GMAIL_AUTHORIZATION_CHANGED"].includes(code)) return "auth";
  if (code === "INBOX_ENUMERATION_LIMIT") return "limit";
  if (code === "INBOX_RUN_BUDGET_REACHED" || code === "INBOX_SYNC_ABORTED" || code === "INBOX_RESYNC_REQUIRED") return "budget";
  if (["GMAIL_RATE_LIMITED", "GMAIL_UNAVAILABLE", "GMAIL_REQUEST_FAILED"].includes(code)) return "backoff";
  if (code === "INBOX_SYNC_ACTIVE") return "busy";
  return "data";
}
export interface ServiceRunResult {
  outcome: InboxSyncOutcome | "idle";
  code: string | null;
  steps: string[];
}
export type InboxState = "never" | "importing" | "resync" | "catching_up" | "up_to_date" | "paused_after_purge" | "disconnected" | "needs_reconnect" | "limit" | "waiting_retry" | "error";
export interface InboxStatusView {
  state: InboxState;
  account: { accountRef: string; email: string; active: boolean } | null;
  accounts: { accountRef: string; email: string; active: boolean; messageCount: number }[];
  connected: boolean;
  running: boolean;
  truncated: boolean;
  catchupPending: boolean;
  resyncRequired: boolean;
  autoSyncPaused: boolean;
  lastSyncAt: number | null;
  nextSyncAt: number | null;
  errorCode: string | null;
  errorCategory: ErrorCategory | null;
  messageCount: number;
  window: { days: number; cap: number };
  context: { accountRef: string | null; revision: number; tag: string };
}
export interface InboxContext {
  info: InboxNamespaceInfo | null;
  connectedSubject: string | null;
  generation: string | null;
  /** Content may be read: same account as the connected one, or Gmail disconnected. */
  readable: boolean;
  readScope: boolean;
  account: string | null;
}
type Timer = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };

export class InboxService {
  private readonly o: InboxServiceOptions;
  private running: Promise<ServiceRunResult> | null = null;
  private controller: AbortController | null = null;
  private timer: unknown = null;
  private closed = false;
  private started = false;
  private suspensions = 0;
  private blockedGeneration: string | null = null;
  readonly sync: GmailInboxSync;
  readonly incremental: GmailInboxIncremental;
  constructor(
    private oauth: InboxCredentialSource,
    readonly store: InboxStore,
    readonly scope: { tenant: string; owner: string },
    fetcher: typeof fetch = fetch,
    options: Partial<InboxServiceOptions> = {},
    private now: () => number = Date.now,
    private timers: Timer = { set: (fn, ms) => setTimeout(fn, ms), clear: h => clearTimeout(h as ReturnType<typeof setTimeout>) },
  ) {
    this.o = { ...DEFAULT_INBOX_SERVICE_OPTIONS, ...options };
    for (const k of ["intervalMs", "minBackoffMs", "maxBackoffMs", "maxStepsPerRun", "purgeConfirmationTtlMs"] as const)
      if (!Number.isSafeInteger(this.o[k]) || this.o[k] < 1) throw new Error("INVALID_INBOX_SERVICE_OPTIONS");
    if (this.o.minBackoffMs > this.o.maxBackoffMs) throw new Error("INVALID_INBOX_SERVICE_OPTIONS");
    this.scope = { ...scope };
    this.sync = new GmailInboxSync(oauth, store, this.scope, fetcher, this.o.sync, now);
    this.incremental = new GmailInboxIncremental(oauth, store, this.scope, fetcher, { ...(this.o.sync.windowMs !== undefined ? { windowMs: this.o.sync.windowMs } : {}), ...this.o.incremental }, now);
  }
  get owner() {
    return this.scope.owner;
  }
  get isRunning() {
    return this.running !== null;
  }
  /** Starts the single automatic timer; calling twice never creates a second one. */
  start(firstDelayMs = 1000) {
    if (this.closed || this.started) return;
    this.started = true;
    this.schedule(firstDelayMs);
  }
  private schedule(ms: number) {
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.tick().catch(() => undefined).finally(() => {
        if (!this.closed && this.timer === null) this.schedule(this.o.intervalMs);
      });
    }, ms);
  }
  /** Automatic step: respects connection, purge pause, backoff and auth block. */
  tick(): Promise<ServiceRunResult> {
    return this.launch(false);
  }
  /** Explicit user action; authorization is rechecked after credential preflight. */
  syncNow(stillAuthorized: () => boolean = () => true): Promise<ServiceRunResult> {
    return this.launch(true, stillAuthorized);
  }
  private launch(manual: boolean, stillAuthorized: () => boolean = () => true): Promise<ServiceRunResult> {
    if (this.closed) return Promise.resolve({ outcome: "failed", code: "INBOX_SERVICE_CLOSED", steps: [] });
    if (this.running || this.suspensions) return Promise.resolve({ outcome: "busy", code: "INBOX_SYNC_ACTIVE", steps: [] });
    // Reserve single-flight synchronously, including the credential await.
    const controller = new AbortController();
    this.controller = controller;
    const work = this.prepareRun(controller.signal, manual, stillAuthorized).finally(() => {
      if (this.running === work) this.running = null;
      if (this.controller === controller) this.controller = null;
    });
    this.running = work;
    return work;
  }
  private async prepareRun(signal: AbortSignal, manual: boolean, stillAuthorized: () => boolean): Promise<ServiceRunResult> {
    const idle = (code: string, outcome: ServiceRunResult["outcome"] = "idle"): ServiceRunResult => ({ outcome, code, steps: [] });
    const cred = await this.oauth.credential().catch(() => null);
    if (signal.aborted || this.closed) return idle("INBOX_SYNC_ABORTED", "paused");
    if (!stillAuthorized()) return idle("INBOX_AUTH_CHANGED", "blocked");
    if (!cred) return idle("GMAIL_NOT_CONNECTED", manual ? "blocked" : "idle");
    if (!cred.scopes.includes(GMAIL_READ_SCOPE)) return idle("GMAIL_READ_SCOPE_MISSING", "blocked");
    if (!manual && this.blockedGeneration === cred.generation) return idle("GMAIL_AUTHORIZATION_REQUIRED");
    this.blockedGeneration = null;
    const ns = inboxNamespace(this.scope.tenant, this.scope.owner, cred.subject);
    const info = this.store.namespaceInfo(ns);
    if (!manual && info?.autoSyncPaused) return idle("INBOX_AUTO_SYNC_PAUSED");
    if (!manual && info?.nextSyncAt && info.nextSyncAt > this.now()) return idle("INBOX_BACKOFF");
    if (manual && info) {
      this.store.resumeAutoSync(ns);
      this.store.setSchedule(ns, { nextSyncAt: null, backoffMs: 0 });
    }
    return this.steps(signal, cred.generation);
  }
  /** Prevent timers/manual starts while disconnecting, connecting or purging. */
  async withSuspended<T>(operation: () => Promise<T>): Promise<T> {
    this.suspensions++;
    try { await this.cancel(); return await operation(); }
    finally { this.suspensions--; }
  }
  /** Authorization actually changed (connect/reconnect completed): a blocked service may resume. */
  onAuthorizationChanged() {
    this.blockedGeneration = null;
  }
  /** Aborts the running step and waits until it has released its lease. */
  async cancel() {
    this.controller?.abort();
    const current = this.running;
    if (current) await current.catch(() => undefined);
  }
  async close() {
    this.closed = true;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    await this.cancel();
  }

  private async steps(signal: AbortSignal, initialGeneration: string): Promise<ServiceRunResult> {
    const steps: string[] = [];
    let last: { outcome: InboxSyncOutcome; code: string | null } = { outcome: "complete", code: null };
    let generation: string | null = null, ns: string | null = null;
    for (let i = 0; i < this.o.maxStepsPerRun; i++) {
      if (signal.aborted) { last = { outcome: "paused", code: "INBOX_SYNC_ABORTED" }; break; }
      const cred = await this.oauth.credential().catch(() => null);
      if (signal.aborted) { last = { outcome: "paused", code: "INBOX_SYNC_ABORTED" }; break; }
      if (cred && cred.generation !== initialGeneration) { last = { outcome: "blocked", code: "GMAIL_AUTHORIZATION_CHANGED" }; break; }
      if (!cred) { last = { outcome: "blocked", code: "GMAIL_NOT_CONNECTED" }; break; }
      generation = cred.generation;
      ns = inboxNamespace(this.scope.tenant, this.scope.owner, cred.subject);
      const info = this.store.namespaceInfo(ns);
      const resync = this.store.resyncActive(ns);
      let step: "full" | "local" | "incremental";
      if (!info || info.fullRunActive || !info.historyId) step = "full";
      else if (info.resyncRequired && resync) step = resync.fullDone ? "local" : "full";
      else step = "incremental";
      steps.push(step);
      if (step === "full") {
        const r = await this.sync.fullSync(signal);
        last = { outcome: r.outcome, code: r.code };
        if (r.outcome !== "complete") break;
        continue;
      }
      if (step === "local") {
        const r = await this.incremental.reconcileLocal(signal);
        last = { outcome: r.outcome, code: r.code };
        if (r.outcome !== "complete") break;
        continue;
      }
      const r = await this.incremental.incremental(signal);
      last = { outcome: r.outcome, code: r.code };
      if (r.resyncRequired) continue;
      break;
    }
    if (ns && this.store.namespace(ns)) this.reschedule(ns, last, generation);
    return { ...last, steps };
  }
  private reschedule(ns: string, last: { outcome: InboxSyncOutcome; code: string | null }, generation: string | null) {
    const category = errorCategory(last.code);
    try {
      if (last.outcome === "complete") this.store.setSchedule(ns, { nextSyncAt: null, backoffMs: 0 });
      else if (category === "backoff") {
        const prev = this.store.namespaceInfo(ns)?.backoffMs ?? 0;
        const next = Math.min(this.o.maxBackoffMs, Math.max(this.o.minBackoffMs, prev * 2));
        this.store.setSchedule(ns, { nextSyncAt: this.now() + next, backoffMs: next });
      } else if (category === "auth") this.blockedGeneration = generation ?? "none";
    } catch {}
  }

  /** Resolves which own account a request refers to, without trusting client-supplied identities. */
  async context(accountRef: string | null): Promise<InboxContext> {
    const cred = await this.oauth.credential().catch(() => null);
    const connectedSubject = cred?.subject ?? null;
    let info: InboxNamespaceInfo | null;
    if (accountRef !== null) {
      info = this.store.namespaceByRef(accountRef);
      if (info && (info.tenant !== this.scope.tenant || info.owner !== this.scope.owner)) info = null;
    } else if (connectedSubject) info = this.store.namespaceInfo(inboxNamespace(this.scope.tenant, this.scope.owner, connectedSubject));
    else info = this.store.namespacesForOwner(this.scope.tenant, this.scope.owner)[0] ?? null;
    return { info, connectedSubject, generation: cred?.generation ?? null, readScope: !!cred?.scopes.includes(GMAIL_READ_SCOPE), readable: !!info && (connectedSubject === null || info.subject === connectedSubject), account: cred?.account ?? null };
  }
  status(ctx: InboxContext): InboxStatusView {
    const info = ctx.info, code = ctx.connectedSubject && !ctx.readScope ? "GMAIL_READ_SCOPE_MISSING" : info?.lastError ?? null, category = errorCategory(code);
    let state: InboxState;
    if (ctx.connectedSubject && !ctx.readScope) state = "needs_reconnect";
    else if (!info) state = "never";
    else if (info.autoSyncPaused) state = "paused_after_purge";
    else if (ctx.connectedSubject === null || info.subject !== ctx.connectedSubject) state = "disconnected";
    else if (category === "auth") state = "needs_reconnect";
    else if (category === "limit") state = "limit";
    else if (category === "backoff" && info.nextSyncAt !== null && info.nextSyncAt > this.now()) state = "waiting_retry";
    else if (info.resyncRequired) state = "resync";
    else if (info.syncState === "never" && !info.fullRunActive) state = "never";
    else if (info.fullRunActive || !info.historyId) state = "importing";
    else if (info.catchupPending || info.incrementalActive) state = "catching_up";
    else if (category === "data") state = "error";
    else state = "up_to_date";
    const accounts = this.store.namespacesForOwner(this.scope.tenant, this.scope.owner).map(n => ({ accountRef: n.accountRef, email: n.account, active: n.subject === ctx.connectedSubject, messageCount: n.messageCount }));
    return {
      state,
      account: info ? { accountRef: info.accountRef, email: info.account, active: info.subject === ctx.connectedSubject } : null,
      accounts,
      connected: ctx.connectedSubject !== null,
      running: this.isRunning,
      truncated: info?.syncState === "complete_truncated",
      catchupPending: !!info?.catchupPending,
      resyncRequired: !!info?.resyncRequired,
      autoSyncPaused: !!info?.autoSyncPaused,
      lastSyncAt: info?.lastSyncAt ?? null,
      nextSyncAt: info?.nextSyncAt ?? null,
      errorCode: code,
      errorCategory: category,
      messageCount: info?.messageCount ?? 0,
      window: { days: Math.round((this.o.sync.windowMs ?? 90 * 86_400_000) / 86_400_000), cap: this.o.sync.selectionCap ?? 2000 },
      context: contextOf(ctx),
    };
  }
  createPurgeConfirmation(info: InboxNamespaceInfo) {
    return this.store.createPurgeToken(info.ns, this.scope.tenant, this.scope.owner, this.o.purgeConfirmationTtlMs);
  }
  /**
   * Cancels and waits for this process' run, re-checks authorization after the
   * wait, then purges atomically. Another process holding the lease → busy.
   */
  async purge(info: InboxNamespaceInfo, confirmationId: string, stillAuthorized: () => boolean) {
    await this.withSuspended(async () => {
      if (!stillAuthorized()) throw new InboxStoreError("INBOX_AUTH_CHANGED");
      this.store.purgeConfirmed(confirmationId, info.ns, this.scope.tenant, this.scope.owner);
    });
  }
}
/** Opaque context tag: lets the UI discard late responses after account, authorization or content changes. */
export function contextOf(ctx: InboxContext) {
  const info = ctx.info;
  return {
    accountRef: info?.accountRef ?? null,
    revision: info?.revision ?? 0,
    tag: createHash("sha256").update(JSON.stringify([info?.ns ?? null, ctx.generation ?? "disconnected"])).digest("hex").slice(0, 24),
  };
}
