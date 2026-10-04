/**
 * P03 — converts a Gmail `messages.get(format=full)` payload into bounded,
 * plain-text local data. Pure function: no network, no attachment download,
 * no remote resources, no HTML execution. Incoming content is data only.
 */
export const INBOX_BODY_MAX_CHARS = 65536;
export const INBOX_HEADER_MAX_CHARS = 2000;
const MAX_DEPTH = 20;
const MAX_PARTS = 200;
const MAX_DECODE_BYTES = 2000000;
const MAX_ATTACHMENTS = 100;
export interface InboxHeaders {
    from: string | null;
    to: string | null;
    cc: string | null;
    replyTo: string | null;
    subject: string | null;
    date: string | null;
    messageId: string | null;
    inReplyTo: string | null;
    references: string | null;
}
export interface InboxAttachmentMeta {
    partId: string;
    filename: string;
    mimeType: string;
    size: number;
}
export interface ParsedInboxMessage {
    headers: InboxHeaders;
    bodyText: string;
    bodySource: "plain" | "html" | "none";
    bodyTruncated: boolean;
    /** A textual MIME part was omitted (attachment-backed or invalid encoding). */
    bodyUnavailable: boolean;
    /** True when a declared charset was unknown and UTF-8 was used instead. */
    charsetFallback: boolean;
    attachments: InboxAttachmentMeta[];
    attachmentsTruncated: boolean;
    /** Part tree exceeded depth/count limits; some parts were not inspected. */
    structureTruncated: boolean;
}
interface Part {
    partId?: unknown;
    mimeType?: unknown;
    filename?: unknown;
    headers?: unknown;
    body?: unknown;
    parts?: unknown;
}
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
function clean(value: string, max: number) {
    return value.replace(CONTROL, "").slice(0, max);
}
function decoderFor(charset: string | null): {
    decode: TextDecoder;
    fallback: boolean;
} {
    const label = (charset ?? "utf-8").trim().toLowerCase();
    try {
        return { decode: new TextDecoder(label, { fatal: false }), fallback: false };
    }
    catch {
        return { decode: new TextDecoder("utf-8", { fatal: false }), fallback: true };
    }
}
/** RFC 2047 encoded-words (B and Q). Unknown charsets fall back to UTF-8. */
export function decodeEncodedWords(value: string): string {
    return value
        .replace(/(=\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=)\s+(?==\?)/g, "$1")
        .replace(/=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g, (_m, charset, enc, text) => {
        try {
            const bytes = enc.toUpperCase() === "B"
                ? Buffer.from(text, "base64")
                : Buffer.from(text
                    .replace(/_/g, " ")
                    .replace(/=([0-9A-Fa-f]{2})/g, (_x: string, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1");
            return decoderFor(charset).decode.decode(bytes);
        }
        catch {
            return _m;
        }
    });
}
function headerMap(raw: unknown): Map<string, string> {
    const map = new Map<string, string>();
    if (!Array.isArray(raw))
        return map;
    for (const h of raw.slice(0, 500)) {
        if (!h || typeof h !== "object")
            continue;
        const name = (h as {
            name?: unknown;
        }).name, value = (h as {
            value?: unknown;
        }).value;
        if (typeof name !== "string" || typeof value !== "string")
            continue;
        const key = name.toLowerCase();
        if (!map.has(key))
            map.set(key, value.slice(0, 20000));
    }
    return map;
}
function charsetOf(contentType: string | undefined) {
    const m = contentType?.match(/charset\s*=\s*"?([^";\s]+)"?/i);
    return m ? m[1]! : null;
}
function decodeData(data: unknown, charset: string | null) {
    if (typeof data !== "string" || !/^[A-Za-z0-9_-]*={0,2}$/.test(data))
        return { text: "", fallback: false, truncated: false, unavailable: true };
    let bytes = Buffer.from(data, "base64url"), truncated = false;
    if (bytes.length > MAX_DECODE_BYTES) {
        bytes = bytes.subarray(0, MAX_DECODE_BYTES);
        truncated = true;
    }
    const d = decoderFor(charset);
    return { text: d.decode.decode(bytes), fallback: d.fallback, truncated, unavailable: false };
}
const ENTITIES: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
};
/** Bounded linear HTML → text scan. Never builds a DOM or fetches resources. */
export function htmlToText(html: string): string {
    const source = html.slice(0, MAX_DECODE_BYTES), lower = source.toLowerCase(), chunks: string[] = [];
    let cursor = 0;
    while (cursor < source.length) {
        const begin = source.indexOf("<", cursor);
        if (begin < 0) {
            chunks.push(source.slice(cursor));
            break;
        }
        chunks.push(source.slice(cursor, begin));
        if (source.startsWith("<!--", begin)) {
            const close = source.indexOf("-->", begin + 4);
            cursor = close < 0 ? source.length : close + 3;
            continue;
        }
        let end = begin + 1;
        while (end < source.length && source[end] !== ">" && source[end] !== "<")
            end++;
        if (end === source.length) {
            chunks.push(source.slice(begin));
            break;
        }
        if (source[end] === "<") {
            chunks.push(source.slice(begin, end));
            cursor = end;
            continue;
        }
        const tag = source.slice(begin + 1, end), block = tag.match(/^\s*(script|style|head|template|noscript)\b/i);
        if (block) {
            const close = lower.indexOf("</" + block[1]!.toLowerCase(), end + 1);
            const closeEnd = close < 0 ? -1 : source.indexOf(">", close);
            cursor = closeEnd < 0 ? source.length : closeEnd + 1;
        }
        else {
            chunks.push(/^\s*br\b|^\s*\/\s*(p|div|li|tr|h[1-6]|blockquote)\b/i.test(tag) ? "\n" : " ");
            cursor = end + 1;
        }
    }
    return chunks.join("")
        .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
        if (e[0] === "#") {
            const code = e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : " ";
        }
        return ENTITIES[e.toLowerCase()] ?? m;
    })
        .replace(/[ \t\f\v\r]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
export function parseGmailPayload(payload: unknown): ParsedInboxMessage {
    const root = (payload && typeof payload === "object" ? payload : {}) as Part;
    const top = headerMap(root.headers);
    const h = (name: string) => {
        const v = top.get(name);
        return v === undefined ? null : clean(decodeEncodedWords(v), INBOX_HEADER_MAX_CHARS);
    };
    const headers: InboxHeaders = {
        from: h("from"),
        to: h("to"),
        cc: h("cc"),
        replyTo: h("reply-to"),
        subject: h("subject"),
        date: h("date"),
        messageId: h("message-id"),
        inReplyTo: h("in-reply-to"),
        references: h("references"),
    };
    const plain: string[] = [], html: string[] = [], attachments: InboxAttachmentMeta[] = [];
    let parts = 0, structureTruncated = false, attachmentsTruncated = false, charsetFallback = false, decodeTruncated = false, bodyUnavailable = false;
    const walk = (node: Part, depth: number, fallbackId: string) => {
        if (depth > MAX_DEPTH || ++parts > MAX_PARTS) {
            structureTruncated = true;
            return;
        }
        const mime = typeof node.mimeType === "string" ? node.mimeType.toLowerCase() : "";
        const hdr = headerMap(node.headers);
        const body = (node.body && typeof node.body === "object" ? node.body : {}) as {
            data?: unknown;
            size?: unknown;
            attachmentId?: unknown;
        };
        const filename = typeof node.filename === "string" ? node.filename : "";
        const disposition = (hdr.get("content-disposition") ?? "").toLowerCase();
        const partId = typeof node.partId === "string" && node.partId ? node.partId.slice(0, 50) : fallbackId;
        const isAttachment = !!filename || typeof body.attachmentId === "string" || disposition.startsWith("attachment");
        if (isAttachment) {
            if ((mime === "text/plain" || mime === "text/html") && !filename && !disposition.startsWith("attachment"))
                bodyUnavailable = true;
            if (attachments.length >= MAX_ATTACHMENTS)
                attachmentsTruncated = true;
            else
                attachments.push({
                    partId,
                    filename: clean(decodeEncodedWords(filename), 255),
                    mimeType: clean(mime || "application/octet-stream", 255),
                    size: Number.isSafeInteger(body.size) && (body.size as number) >= 0 ? (body.size as number) : 0,
                });
            return; // never decode or keep attachment content
        }
        if (mime === "text/plain" || mime === "text/html") {
            const decoded = decodeData(body.data, charsetOf(hdr.get("content-type")));
            charsetFallback ||= decoded.fallback;
            decodeTruncated ||= decoded.truncated;
            bodyUnavailable ||= decoded.unavailable;
            (mime === "text/plain" ? plain : html).push(decoded.text);
        }
        if (Array.isArray(node.parts))
            node.parts.forEach((child, i) => {
                if (child && typeof child === "object")
                    walk(child as Part, depth + 1, partId + "." + i);
            });
    };
    walk(root, 0, "0");
    let bodySource: ParsedInboxMessage["bodySource"] = "none", text = "";
    if (plain.some((p) => p.trim())) {
        bodySource = "plain";
        text = plain.join("\n\n");
    }
    else if (html.some((p) => p.trim())) {
        bodySource = "html";
        text = htmlToText(html.join("\n"));
    }
    text = text.replace(CONTROL, "");
    const bodyTruncated = decodeTruncated || text.length > INBOX_BODY_MAX_CHARS;
    return {
        headers,
        bodyText: text.slice(0, INBOX_BODY_MAX_CHARS),
        bodySource,
        bodyTruncated,
        bodyUnavailable,
        charsetFallback,
        attachments,
        attachmentsTruncated,
        structureTruncated,
    };
}
