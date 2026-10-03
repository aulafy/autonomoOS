import {
  validateEmailPayload,
  emailHash,
  type EmailPayload,
} from "./email-provider.js";
export function gmailMessageId(key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("INVALID_EMAIL_KEY");
  return `<awos.${key}@autonomo-os.invalid>`;
}
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
      "X-AWOS-Payload-SHA256: " + emailHash(p),
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
 * Any unexpected MIME transformation fails to UNKNOWN rather than guessing. */
export function verifyGmailRaw(
  raw: string,
  expected: EmailPayload,
  key: string,
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
            "x-awos-payload-sha256",
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
    return (
      headers.get("message-id") === gmailMessageId(key) &&
      headers.get("x-awos-payload-sha256") === emailHash(expected) &&
      headers.get("from") === expected.from &&
      headers.get("to") === expected.to[0] &&
      !headers.has("cc") &&
      !headers.has("bcc") &&
      subject === expected.subject &&
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
