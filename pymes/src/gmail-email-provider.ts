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
}
/** Durable attempt ledger is evidence of an attempt, never evidence of delivery.
 * Gmail messages.send has no native idempotency guarantee: never repeat POST. */
export class GmailEmailProvider implements EmailProvider {
  readonly id = "gmail-email";
  private db: DatabaseSync;
  private accountValue: string | null = null;
  private bindingValue: string | null = null;
  constructor(
    private oauth: GmailOAuth,
    path: string,
    private fetcher: typeof fetch = fetch,
    private timeoutMs = 15000,
  ) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
      throw new Error("INVALID_GMAIL_TIMEOUT");
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS claims(key TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,payload TEXT NOT NULL,subject TEXT NOT NULL,message_id TEXT NOT NULL,gmail_id TEXT)",
    );
  }
  async status() {
    const s = await this.oauth.status();
    this.accountValue = s.state === "connected" ? s.account : null;
    this.bindingValue = null;
    if (this.accountValue) {
      try {
        const c = await this.oauth.credential();
        this.bindingValue = emailHash({
          provider: this.id,
          subject: c.subject,
          generation: c.generation,
        });
      } catch {
        this.accountValue = null;
        this.oauth.markError();
        return this.oauth.status();
      }
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
      .prepare("INSERT INTO claims VALUES(?,?,?,?,?,NULL)")
      .run(key, hash, JSON.stringify(p), c.subject, gmailMessageId(key));
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
    async function verify(id: string) {
      if (!/^[-a-zA-Z0-9_]{1,100}$/.test(id)) return false;
      const r = await read(`messages/${id}?format=raw`);
      return (
        r.status === 200 &&
        r.value.id === id &&
        Array.isArray(r.value.labelIds) &&
        r.value.labelIds.includes("SENT") &&
        typeof r.value.raw === "string" &&
        verifyGmailRaw(r.value.raw, expected, key)
      );
    }
    try {
      if (claim.gmail_id && (await verify(claim.gmail_id)))
        return {
          id: "gmail:" + claim.gmail_id,
          key,
          payloadHash: claim.payload_hash,
        };
      const query = new URLSearchParams({
          q: "in:sent rfc822msgid:" + claim.message_id,
          maxResults: "10",
        }),
        r = await read("messages?" + query);
      if (
        r.status !== 200 ||
        r.value.nextPageToken ||
        !Array.isArray(r.value.messages) ||
        r.value.messages.length !== 1
      )
        return null;
      const candidate = r.value.messages[0];
      if (
        !candidate ||
        typeof candidate !== "object" ||
        typeof candidate.id !== "string" ||
        !(await verify(candidate.id))
      )
        return null;
      return {
        id: "gmail:" + candidate.id,
        key,
        payloadHash: claim.payload_hash,
      };
    } catch {
      return null;
    }
  }
  close() {
    this.db.close();
  }
}
