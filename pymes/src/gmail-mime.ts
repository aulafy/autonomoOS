import { createHash } from "node:crypto";
import {
  validateEmailPayload,
  emailHash,
  type EmailPayload,
} from "./email-provider.js";
export function gmailMessageId(key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("INVALID_EMAIL_KEY");
  return `<awos.${key}@autonomo-os.invalid>`;
}
/** Identity marker for identity version 2. Derived from the C6 effect key with
 * a domain separator: correlates the message to exactly one effect, unlike the
 * payload hash (two effects may share a payload). Does not depend on Gmail
 * preserving Message-ID, which a real pilot send showed is not guaranteed. */
export const GMAIL_EFFECT_HEADER = "X-AWOS-Effect-Key";
export function gmailEffectMarker(key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("INVALID_EMAIL_KEY");
  return (
    "awos2." +
    createHash("sha256")
      .update("awos-effect-marker-v2\0" + key)
      .digest("hex")
  );
}
/** 1 = legacy claims (Message-ID is the only identity); 2 = effect marker. */
export type GmailIdentityVersion = 1 | 2;
export function gmailPayload(value: unknown, account: string): EmailPayload {
  const p = validateEmailPayload(value);
  if (
    p.from !== account ||
    p.to.length !== 1 ||
    p.cc.length ||
    p.bcc.length ||
    /[\r\n]/.test(p.from + p.to.join(""))
  )
    throw new Error("GMAIL_PAYLOAD_SCOPE_DENIED");
  return p;
}
const encodedSubject = (s: string) => {
  const chunks: string[] = [];
  let chunk = "";
  for (const c of s) {
    if (Buffer.byteLength(chunk + c) > 30) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += c;
  }
  if (chunk) chunks.push(chunk);
  return chunks
    .map((c) => `=?UTF-8?B?${Buffer.from(c).toString("base64")}?=`)
    .join("\r\n ");
};
export function gmailMime(p: EmailPayload, key: string) {
  return (
    [
      "From: " + p.from,
      "To: " + p.to[0],
      "Subject: " + encodedSubject(p.subject),
      "Message-ID: " + gmailMessageId(key),
      ...(p.reply?["In-Reply-To: "+p.reply.inReplyTo,"References: "+p.reply.references]:[]),
      "X-AWOS-Payload-SHA256: " + emailHash(p),
      GMAIL_EFFECT_HEADER + ": " + gmailEffectMarker(key),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      "",
    ].join("\r\n") +
    (
      Buffer.from(p.body)
        .toString("base64")
        .match(/.{1,76}/g) ?? []
    ).join("\r\n") +
    "\r\n"
  );
}
/** Accepts only the single text/plain message form emitted by this adapter.
 * Any unexpected MIME transformation fails to UNKNOWN rather than guessing.
 * Version 1 (legacy claims): identity is the deterministic Message-ID, exactly
 * as before; the effect marker is neither required nor trusted.
 * Version 2: identity is exactly one well-formed effect marker equal to this
 * key's marker; Message-ID may have been replaced by Gmail and is not used as
 * identity. Content checks are identical in both versions. */
export function verifyGmailRaw(
  raw: string,
  expected: EmailPayload,
  key: string,
  version: GmailIdentityVersion = 1,
): boolean {
  try {
    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(raw) || raw.length > 200000)
      return false;
    const message = Buffer.from(raw, "base64url").toString("utf8"),
      boundary = message.indexOf("\r\n\r\n");
    if (boundary < 0) return false;
    const headers = new Map<string, string>();
    for (const line of message
      .slice(0, boundary)
      .replace(/\r\n[ \t]+/g, " ")
      .split("\r\n")) {
      const colon = line.indexOf(":");
      if (colon <= 0) return false;
      const name = line.slice(0, colon).toLowerCase();
      if (headers.has(name)) {
        if (
          [
            "from",
            "to",
            "cc",
            "bcc",
            "subject",
            "message-id",
            "in-reply-to",
            "references",
            "x-awos-payload-sha256",
            "x-awos-effect-key",
            "content-type",
            "content-transfer-encoding",
            "mime-version",
          ].includes(name)
        )
          return false;
        continue;
      }
      headers.set(name, line.slice(colon + 1).trim());
    }
    const subject = (headers.get("subject") ?? "")
      .replace(/(=\?UTF-8\?B\?[^?]+\?=)\s+(?==\?UTF-8\?B\?)/gi, "$1")
      .replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b) =>
        Buffer.from(b, "base64").toString("utf8"),
      );
    const data = message.slice(boundary + 4).replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return false;
    const identity =
      version === 2
        ? headers.get("x-awos-effect-key") === gmailEffectMarker(key)
        : headers.get("message-id") === gmailMessageId(key);
    return (
      identity &&
      headers.get("x-awos-payload-sha256") === emailHash(expected) &&
      headers.get("from") === expected.from &&
      headers.get("to") === expected.to[0] &&
      !headers.has("cc") &&
      !headers.has("bcc") &&
      subject === expected.subject &&
      (expected.reply?headers.get('in-reply-to')===expected.reply.inReplyTo&&headers.get('references')===expected.reply.references:!headers.has('in-reply-to')&&!headers.has('references')) &&
      /^text\/plain\s*;\s*charset="?UTF-8"?$/i.test(
        headers.get("content-type") ?? "",
      ) &&
      headers.get("content-transfer-encoding")?.toLowerCase() === "base64" &&
      Buffer.from(data, "base64").toString("utf8") === expected.body
    );
  } catch {
    return false;
  }
}
