import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export interface EmailPayload {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  contactId: string;
}
export interface EmailReceipt {
  id: string;
  key: string;
  payloadHash: string;
}
export interface EmailProvider {
  readonly id: string;
  prepare(payload: unknown): EmailPayload;
  send(
    payload: EmailPayload,
    key: string,
    signal: AbortSignal,
  ): Promise<EmailReceipt>;
  observe(key: string, signal: AbortSignal): Promise<EmailReceipt | null>;
  reconcile(key: string, signal: AbortSignal): Promise<EmailReceipt | null>;
}
export function emailHash(value: unknown): string {
  const canonical = (v: unknown): string => {
    if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
    if (v && typeof v === "object")
      return (
        "{" +
        Object.keys(v)
          .sort()
          .map(
            (k) =>
              JSON.stringify(k) +
              ":" +
              canonical((v as Record<string, unknown>)[k]),
          )
          .join(",") +
        "}"
      );
    if (
      v === null ||
      typeof v === "string" ||
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v))
    )
      return JSON.stringify(v);
    throw new Error("INVALID_EMAIL_HASH_INPUT");
  };
  return createHash("sha256").update(canonical(value)).digest("hex");
}
export function validateEmailPayload(value: unknown): EmailPayload {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("INVALID_EMAIL_PAYLOAD");
  const p = value as Record<string, unknown>;
  if (
    Object.keys(p).sort().join(",") !==
    ["from", "to", "cc", "bcc", "subject", "body", "contactId"].sort().join(",")
  )
    throw new Error("INVALID_EMAIL_PAYLOAD");
  const address = (v: unknown) =>
    typeof v === "string" &&
    /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v) &&
    v.length <= 254;
  if (
    !address(p.from) ||
    !["to", "cc", "bcc"].every(
      (k) =>
        Array.isArray(p[k]) &&
        (p[k] as unknown[]).length <= 10 &&
        (p[k] as unknown[]).every(address),
    ) ||
    !(p.to as unknown[]).length
  )
    throw new Error("INVALID_EMAIL_ADDRESS");
  for (const key of ["subject", "body", "contactId"])
    if (
      typeof p[key] !== "string" ||
      !(p[key] as string).trim() ||
      (p[key] as string).length > (key === "body" ? 8000 : 500) ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(p[key] as string)
    )
      throw new Error("INVALID_EMAIL_CONTENT");
  if (
    /[\r\n]/.test(p.subject as string) ||
    /[\r\n]/.test(p.contactId as string)
  )
    throw new Error("INVALID_EMAIL_HEADER");
  const all = [
    ...(p.to as string[]),
    ...(p.cc as string[]),
    ...(p.bcc as string[]),
  ];
  if (new Set(all.map((a) => a.toLowerCase())).size !== all.length)
    throw new Error("DUPLICATE_EMAIL_RECIPIENT");
  return structuredClone(p) as unknown as EmailPayload;
}
/** Simulated mailbox, intentionally separate from the runtime journal. No network.
 * Observer queries persisted receipts; a returned executor success is not proof. */
export class FakeEmailProvider implements EmailProvider {
  readonly id = "fake-email";
  private db: DatabaseSync;
  constructor(
    path: string,
    private options: {
      loseResponse?: boolean;
      rejectBeforeSend?: boolean;
      afterSend?: () => void;
      hideObservation?: boolean;
    } = {},
  ) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS receipts (key TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS calls (key TEXT NOT NULL)",
    );
  }
  prepare(value: unknown): EmailPayload {
    const p = validateEmailPayload(value);
    if (
      [p.from, ...p.to, ...p.cc, ...p.bcc].some(
        (a) => !a.endsWith("@example.test"),
      )
    )
      throw new Error("FAKE_EMAIL_HOST_SCOPE_DENIED");
    return p;
  }
  async send(
    value: EmailPayload,
    key: string,
    signal: AbortSignal,
  ): Promise<EmailReceipt> {
    signal.throwIfAborted();
    const p = this.prepare(value);
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("INVALID_EMAIL_KEY");
    if (this.options.rejectBeforeSend)
      throw new Error("FAKE_EMAIL_CERTIFIED_NOT_STARTED");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO calls(key) VALUES(?)").run(key);
      const row = this.db
        .prepare("SELECT payload_hash FROM receipts WHERE key=?")
        .get(key) as { payload_hash: string } | undefined;
      if (row && row.payload_hash !== emailHash(p))
        throw new Error("EMAIL_IDEMPOTENCY_CONFLICT");
      this.db
        .prepare("INSERT OR IGNORE INTO receipts VALUES(?,?,?)")
        .run(key, emailHash(p), JSON.stringify(p));
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    this.options.afterSend?.();
    if (this.options.loseResponse) throw new Error("FAKE_EMAIL_RESPONSE_LOST");
    return { id: `fake:${key}`, key, payloadHash: emailHash(p) };
  }
  async observe(
    key: string,
    signal: AbortSignal,
  ): Promise<EmailReceipt | null> {
    signal.throwIfAborted();
    if (this.options.hideObservation) return null;
    return this.lookup(key);
  }
  async reconcile(
    key: string,
    signal: AbortSignal,
  ): Promise<EmailReceipt | null> {
    signal.throwIfAborted();
    return this.lookup(key);
  }
  private lookup(key: string): EmailReceipt | null {
    const row = this.db
      .prepare("SELECT payload_hash FROM receipts WHERE key=?")
      .get(key) as { payload_hash: string } | undefined;
    return row
      ? { id: `fake:${key}`, key, payloadHash: row.payload_hash }
      : null;
  }
  counts() {
    return {
      sent: Number(
        (
          this.db.prepare("SELECT count(*) n FROM receipts").get() as {
            n: number;
          }
        ).n,
      ),
      calls: Number(
        (this.db.prepare("SELECT count(*) n FROM calls").get() as { n: number })
          .n,
      ),
    };
  }
  close() {
    this.db.close();
  }
}
