import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  emailHash,
  EmailDispatchError,
  type EmailProvider,
  type EmailPayload,
  type EmailReceipt,
} from "./email-provider.js";
import {
  GmailOAuth,
  GMAIL_READ_SCOPE,
  googleJson,
  type GmailCredential,
} from "./gmail-oauth.js";
import {
  gmailPayload,
  gmailMime,
  gmailMessageId,
  verifyGmailRaw,
} from "./gmail-mime.js";
interface Claim {
  key: string;
  payload_hash: string;
  payload: string;
  subject: string;
  message_id: string;
  gmail_id: string | null;
  /** NULL for claims written before P02 (legacy, identity version 1). */
  identity_version: number | null;
  claimed_at: number | null;
}
const GMAIL_ID = /^[-a-zA-Z0-9_]{1,100}$/;
/** Bounded SENT scan used only for identity-version-2 claims when the known
 * Gmail id and the Message-ID search give no proof. Exceeding any bound keeps
 * UNKNOWN: a finite listing never proves absence or global uniqueness. */
export interface GmailScanBudget {
  pageSize: number;
  maxPages: number;
  maxRawReads: number;
  /** Listing starts this long before the claim time (q=after:). */
  windowBeforeClaimMs: number;
}
export const DEFAULT_GMAIL_SCAN_BUDGET: GmailScanBudget = {
  pageSize: 100,
  maxPages: 5,
  maxRawReads: 200,
  windowBeforeClaimMs: 86_400_000,
};
type Verdict = "match" | "no_match" | "unverifiable";
/** Durable attempt ledger is evidence of an attempt, never evidence of delivery.
 * Gmail messages.send has no native idempotency guarantee: never repeat POST. */
export class GmailEmailProvider implements EmailProvider {
  readonly id = "gmail-email";
  private db: DatabaseSync;
  private accountValue: string | null = null;
  private bindingValue: string | null = null;
  private statusSeq = 0;
  constructor(
    private oauth: GmailOAuth,
    path: string,
    private fetcher: typeof fetch = fetch,
    private timeoutMs = 15000,
    private scanBudget: GmailScanBudget = DEFAULT_GMAIL_SCAN_BUDGET,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
      throw new Error("INVALID_GMAIL_TIMEOUT");
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    if (
      !Number.isInteger(scanBudget.pageSize) ||
      scanBudget.pageSize < 1 ||
      scanBudget.pageSize > 100 ||
      !Number.isInteger(scanBudget.maxPages) ||
      scanBudget.maxPages < 1 ||
      scanBudget.maxPages > 5 ||
      !Number.isInteger(scanBudget.maxRawReads) ||
      scanBudget.maxRawReads < 1 ||
      scanBudget.maxRawReads > 200 ||
      !Number.isSafeInteger(scanBudget.windowBeforeClaimMs) ||
      scanBudget.windowBeforeClaimMs < 0 ||
      scanBudget.windowBeforeClaimMs > 86_400_000
    )
      throw new Error("INVALID_GMAIL_SCAN_BUDGET");
    this.scanBudget = { ...scanBudget };
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS claims(key TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,payload TEXT NOT NULL,subject TEXT NOT NULL,message_id TEXT NOT NULL,gmail_id TEXT)",
    );
    // Additive migration. Existing rows keep NULL = legacy identity version 1;
    // they are never rewritten, re-sent or upgraded.
    const columns = new Set(
      (
        this.db.prepare("PRAGMA table_info(claims)").all() as unknown as {
          name: string;
        }[]
      ).map((c) => c.name),
    );
    if (!columns.has("identity_version"))
      this.db.exec("ALTER TABLE claims ADD COLUMN identity_version INTEGER");
    if (!columns.has("claimed_at"))
      this.db.exec("ALTER TABLE claims ADD COLUMN claimed_at INTEGER");
  }
  /** Computes account and binding off to the side and publishes them together
   * once all awaits finish. Only the most recent call publishes, so a slower,
   * older poll cannot restore a stale binding. Disconnection or credential
   * failure still clears both. send() re-validates the live credential anyway. */
  async status() {
    const seq = ++this.statusSeq;
    const s = await this.oauth.status();
    let account: string | null = s.state === "connected" ? s.account : null,
      binding: string | null = null;
    if (account) {
      try {
        const c = await this.oauth.credential();
        account = c.account;
        binding = emailHash({
          provider: this.id,
          subject: c.subject,
          generation: c.generation,
        });
      } catch {
        if (seq === this.statusSeq) {
          this.accountValue = null;
          this.bindingValue = null;
        }
        // A failed stale poll must not revoke a newer successful connection.
        if (seq === this.statusSeq) this.oauth.markError();
        return this.oauth.status();
      }
    }
    if (seq === this.statusSeq) {
      this.accountValue = account;
      this.bindingValue = binding;
    }
    return s;
  }
  account() {
    if (!this.accountValue) throw new Error("GMAIL_NOT_CONNECTED");
    return this.accountValue;
  }
  approvalBinding() {
    if (!this.bindingValue) throw new Error("GMAIL_NOT_CONNECTED");
    return this.bindingValue;
  }
  prepare(value: unknown) {
    return gmailPayload(value, this.account());
  }
  private claim(key: string): Claim | null {
    return (
      (this.db
        .prepare("SELECT * FROM claims WHERE key=?")
        .get(key) as unknown as Claim | undefined) ?? null
    );
  }
  async send(
    value: EmailPayload,
    key: string,
    signal: AbortSignal,
  ): Promise<EmailReceipt> {
    let c: GmailCredential, p: EmailPayload;
    try {
      signal.throwIfAborted();
      gmailMessageId(key);
      c = await this.oauth.credential();
      p = this.prepare(value);
      if (
        p.from !== c.account ||
        !this.oauth.permits(c) ||
        emailHash({
          provider: this.id,
          subject: c.subject,
          generation: c.generation,
        }) !== this.bindingValue
      )
        throw 0;
      signal.throwIfAborted();
    } catch {
      throw new EmailDispatchError("GMAIL_PRE_DISPATCH_DENIED", "not_started");
    }
    const hash = emailHash(p),
      previous = this.claim(key);
    if (previous)
      throw new EmailDispatchError("GMAIL_ALREADY_ATTEMPTED", "unknown");
    // Claim persisted before HTTP. A crash in the following gap must remain UNKNOWN.
    this.db
      .prepare(
        "INSERT INTO claims(key,payload_hash,payload,subject,message_id,gmail_id,identity_version,claimed_at) VALUES(?,?,?,?,?,NULL,2,?)",
      )
      .run(
        key,
        hash,
        JSON.stringify(p),
        c.subject,
        gmailMessageId(key),
        Date.now(),
      );
    let r: { status: number; value: Record<string, unknown> };
    try {
      r = await googleJson(
        this.fetcher,
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + c.accessToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            raw: Buffer.from(gmailMime(p, key)).toString("base64url"),
          }),
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(this.timeoutMs),
          ]),
        },
      );
    } catch {
      throw new EmailDispatchError("GMAIL_SEND_UNCONFIRMED", "unknown");
    }
    if (r.status === 401 || r.status === 403) this.oauth.markError();
    if (
      r.status !== 200 ||
      typeof r.value.id !== "string" ||
      !/^[-a-zA-Z0-9_]{1,100}$/.test(r.value.id)
    )
      throw new EmailDispatchError("GMAIL_SEND_UNCONFIRMED", "unknown");
    this.db
      .prepare("UPDATE claims SET gmail_id=? WHERE key=?")
      .run(r.value.id, key);
    return { id: "gmail:" + r.value.id, key, payloadHash: hash };
  }
  async observe(key: string, signal: AbortSignal) {
    return this.lookup(key, signal);
  }
  async reconcile(key: string, signal: AbortSignal) {
    return this.lookup(key, signal);
  }
  /** Independent evidence lookup. GET only: never POSTs, never treats absence,
   * errors, truncation or exhausted budgets as proof of non-delivery. */
  private async lookup(
    key: string,
    signal: AbortSignal,
  ): Promise<EmailReceipt | null> {
    const claim = this.claim(key);
    if (!claim) return null;
    let c: GmailCredential;
    try {
      c = await this.oauth.credential();
    } catch {
      return null;
    }
    if (c.subject !== claim.subject || !c.scopes.includes(GMAIL_READ_SCOPE))
      return null;
    if (
      claim.identity_version !== null &&
      claim.identity_version !== 1 &&
      claim.identity_version !== 2
    )
      return null;
    const version = claim.identity_version === 2 ? 2 : 1;
    const read = async (path: string) =>
      googleJson(
        this.fetcher,
        "https://gmail.googleapis.com/gmail/v1/users/me/" + path,
        {
          headers: { Authorization: "Bearer " + c.accessToken },
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(this.timeoutMs),
          ]),
        },
      );
    const expected = JSON.parse(claim.payload) as EmailPayload;
    const receipt = (id: string): EmailReceipt => ({
      id: "gmail:" + id,
      key,
      payloadHash: claim.payload_hash,
    });
    const verify = async (id: string): Promise<Verdict> => {
      if (!GMAIL_ID.test(id)) return "unverifiable";
      let r;
      try {
        r = await read(`messages/${id}?format=raw`);
      } catch {
        return "unverifiable";
      }
      if (r.status !== 200 || r.value.id !== id) return "unverifiable";
      if (
        !Array.isArray(r.value.labelIds) ||
        typeof r.value.raw !== "string" ||
        !/^[A-Za-z0-9_-]+={0,2}$/.test(r.value.raw) ||
        r.value.raw.length > 200000 ||
        !Buffer.from(r.value.raw, "base64url")
          .toString("utf8")
          .includes("\r\n\r\n")
      )
        return "unverifiable";
      return r.value.labelIds.includes("SENT") &&
        verifyGmailRaw(r.value.raw, expected, key, version)
        ? "match"
        : "no_match";
    };
    try {
      if (claim.gmail_id && (await verify(claim.gmail_id)) === "match")
        return receipt(claim.gmail_id);
      // Fast path: Message-ID search. Kept for both versions; for v2 a miss is
      // expected when Gmail replaced the Message-ID, so it falls through.
      const query = new URLSearchParams({
        q: "in:sent rfc822msgid:" + claim.message_id,
        maxResults: "10",
      });
      const r = await read("messages?" + query).catch(() => null);
      if (
        r &&
        r.status === 200 &&
        !r.value.nextPageToken &&
        Array.isArray(r.value.messages) &&
        r.value.messages.length === 1
      ) {
        const candidate = r.value.messages[0];
        if (
          candidate &&
          typeof candidate === "object" &&
          typeof candidate.id === "string" &&
          (await verify(candidate.id)) === "match"
        )
          return receipt(candidate.id);
      }
      if (version !== 2 || !Number.isSafeInteger(claim.claimed_at)) return null;
      const found = await this.scanSent(
        read,
        verify,
        claim.claimed_at as number,
        signal,
      );
      return found ? receipt(found) : null;
    } catch {
      return null;
    }
  }
  /** Lists SENT (labelIds=SENT, q=after:<claim - window>) page by page and
   * verifies each candidate's raw content and effect marker. Returns the id
   * only if exactly one match exists in a listing that was read to its end
   * without any error, unverifiable candidate or exhausted budget. */
  private async scanSent(
    read: (
      path: string,
    ) => Promise<{ status: number; value: Record<string, unknown> }>,
    verify: (id: string) => Promise<Verdict>,
    claimedAt: number,
    signal: AbortSignal,
  ): Promise<string | null> {
    const b = this.scanBudget,
      after = Math.max(
        0,
        Math.floor((claimedAt - b.windowBeforeClaimMs) / 1000),
      ),
      seen = new Set<string>(),
      seenTokens = new Set<string>();
    let pageToken: string | null = null,
      pages = 0,
      reads = 0,
      match: string | null = null;
    while (true) {
      signal.throwIfAborted();
      if (pages >= b.maxPages) return null;
      const q = new URLSearchParams({
        labelIds: "SENT",
        maxResults: String(b.pageSize),
        q: "after:" + after,
      });
      if (pageToken) q.set("pageToken", pageToken);
      const r = await read("messages?" + q);
      pages++;
      if (r.status !== 200) return null;
      const messages = r.value.messages === undefined ? [] : r.value.messages;
      if (!Array.isArray(messages) || messages.length > b.pageSize) return null;
      for (const m of messages) {
        if (
          !m ||
          typeof m !== "object" ||
          typeof (m as { id?: unknown }).id !== "string" ||
          !GMAIL_ID.test((m as { id: string }).id)
        )
          return null;
        const id = (m as { id: string }).id;
        if (seen.has(id)) return null; // Pagination drift cannot establish uniqueness.
        seen.add(id);
        if (++reads > b.maxRawReads) return null;
        const v = await verify(id);
        if (v === "unverifiable") return null;
        if (v === "match") {
          if (match) return null; // two messages claim this effect: ambiguous
          match = id;
        }
      }
      const next = r.value.nextPageToken;
      if (next === undefined || next === null || next === "") break;
      if (
        typeof next !== "string" ||
        next.length > 1024 ||
        seenTokens.has(next)
      )
        return null;
      seenTokens.add(next);
      pageToken = next;
    }
    return match;
  }
  close() {
    this.db.close();
  }
}
