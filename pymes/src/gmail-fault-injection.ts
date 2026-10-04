import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
  statSync,
  constants,
  unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

/**
 * P01 — pilot-only response-loss injection for M3 acceptance test C.
 *
 * Wraps the injectable transport already shared by GmailOAuth and
 * GmailEmailProvider. It never sends anything itself and never repeats a
 * request: for exactly one armed messages.send POST it forwards the request
 * once to Google, consumes the real response and, only if Google confirmed
 * acceptance (HTTP 200 + message id), withholds it from the adapter by
 * throwing. The adapter then classifies the attempt as UNKNOWN through its
 * existing path (GMAIL_SEND_UNCONFIRMED). C1–C12 semantics are untouched.
 *
 * Activation is explicit (an arm file chosen by the owner), bound to
 * tenant/owner, restricted to one Subject + To pair, and single-use: the
 * consumption record is created with O_EXCL and fsync before the POST, so a
 * restart with the same configuration leaves the harness inert.
 *
 * The state file holds only allowed metadata: phase, pid, timestamps, HTTP
 * status, Gmail message id and the Message-ID marker. Never Authorization,
 * tokens, OAuth client data or message bodies.
 */
export const GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
export const P01_SUBJECT_PREFIX = "M3-C-";
export const P01_DISCARDED = "P01_ACCEPTED_RESPONSE_DISCARDED";

export interface P01Arm {
  version: 1;
  tenant: string;
  owner: string;
  subject: string;
  to: string;
}

export type P01Phase = "claimed" | "response_discarded" | "not_activated";

export interface P01State {
  version: 1;
  phase: P01Phase;
  pid: number;
  processStart: string;
  armHash: string;
  payloadHash: string | null;
  claimedAt: string;
  updatedAt: string;
  messageId: string | null;
  httpStatus: number | null;
  gmailId: string | null;
  reason: string | null;
}

const EMAIL = /^[^\s@<>()",;:\\[\]]{1,64}@[A-Za-z0-9.-]{1,253}$/;

/** Reads and validates the arm file. Fails closed on any mismatch. */
export function loadP01Arm(
  path: string,
  scope: { tenant: string; owner: string },
): P01Arm {
  let value: unknown;
  try {
    if (statSync(path).size > 4096) throw 0;
    const text = readFileSync(path, "utf8");
    if (Buffer.byteLength(text) > 4096) throw 0;
    value = JSON.parse(text);
  } catch {
    throw new Error("P01_ARM_INVALID");
  }
  const a = value as Partial<P01Arm> | null;
  if (
    !a ||
    typeof a !== "object" ||
    Array.isArray(a) ||
    Object.keys(a).sort().join(",") !== "owner,subject,tenant,to,version" ||
    a.version !== 1 ||
    typeof a.tenant !== "string" ||
    typeof a.owner !== "string" ||
    typeof a.subject !== "string" ||
    typeof a.to !== "string"
  )
    throw new Error("P01_ARM_INVALID");
  if (a.tenant !== scope.tenant || a.owner !== scope.owner)
    throw new Error("P01_ARM_SCOPE_MISMATCH");
  if (
    !a.subject.startsWith(P01_SUBJECT_PREFIX) ||
    a.subject.length < P01_SUBJECT_PREFIX.length + 8 ||
    a.subject.length > 200 ||
    /[\r\n]/.test(a.subject)
  )
    throw new Error("P01_ARM_SUBJECT_INVALID");
  if (!EMAIL.test(a.to) || a.to.endsWith("@example.test"))
    throw new Error("P01_ARM_RECIPIENT_INVALID");
  return a as P01Arm;
}

export function p01StatePath(armPath: string) {
  return armPath + ".state.json";
}

export function readP01State(armPath: string): P01State | null {
  const path = p01StatePath(armPath);
  if (!existsSync(path)) return null;
  try {
    if (statSync(path).size > 8192) throw 0;
    const v = JSON.parse(readFileSync(path, "utf8")) as P01State;
    if (
      !v ||
      v.version !== 1 ||
      !["claimed", "response_discarded", "not_activated"].includes(v.phase) ||
      !Number.isSafeInteger(v.pid) ||
      v.pid <= 1 ||
      typeof v.processStart !== "string" ||
      !v.processStart.trim() ||
      v.processStart.length > 100 ||
      typeof v.armHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(v.armHash) ||
      !(
        v.payloadHash === null ||
        (typeof v.payloadHash === "string" &&
          /^[a-f0-9]{64}$/.test(v.payloadHash))
      ) ||
      typeof v.claimedAt !== "string" ||
      !Number.isFinite(Date.parse(v.claimedAt)) ||
      typeof v.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(v.updatedAt)) ||
      !(
        v.messageId === null ||
        (typeof v.messageId === "string" &&
          /^<awos\.[a-f0-9]{64}@autonomo-os\.invalid>$/.test(v.messageId))
      ) ||
      !(
        v.gmailId === null ||
        (typeof v.gmailId === "string" &&
          /^[-a-zA-Z0-9_]{1,100}$/.test(v.gmailId))
      ) ||
      !(
        v.httpStatus === null ||
        (Number.isInteger(v.httpStatus) &&
          v.httpStatus >= 100 &&
          v.httpStatus <= 599)
      ) ||
      !(
        v.reason === null ||
        (typeof v.reason === "string" && /^[A-Z_]{1,80}$/.test(v.reason))
      )
    )
      throw 0;
    return v;
  } catch {
    throw new Error("P01_STATE_INVALID");
  }
}

export function p01ArmHash(arm: P01Arm) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: arm.version,
        tenant: arm.tenant,
        owner: arm.owner,
        subject: arm.subject,
        to: arm.to,
      }),
    )
    .digest("hex");
}
export function p01ProcessStart(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 1)
    throw new Error("P01_PID_INVALID");
  try {
    const start = execFileSync(
      "/bin/ps",
      ["-p", String(pid), "-o", "lstart="],
      { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (!start) throw 0;
    return start;
  } catch {
    throw new Error("P01_PROCESS_UNCONFIRMED");
  }
}
function syncDirectory(path: string) {
  const fd = openSync(dirname(path), "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
async function boundedResponse(response: Response) {
  const reader = response.body?.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  if (reader) {
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 200000) throw new Error("P01_RESPONSE_TOO_LARGE");
        parts.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  return Buffer.concat(parts).toString("utf8");
}
function durableWrite(path: string, value: P01State, exclusive: boolean) {
  const data = JSON.stringify(value, null, 2) + "\n";
  if (exclusive) {
    const fd = openSync(path, "wx", 0o600);
    try {
      writeSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    syncDirectory(path);
    return;
  }
  const tmp = path + ".tmp-" + randomBytes(8).toString("hex");
  const fd = openSync(
    tmp,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
    syncDirectory(path);
  } finally {
    if (existsSync(tmp)) unlinkSync(tmp);
  }
}

/** Extracts Subject, To and Message-ID from the request body without
 * retaining the body. Returns null for anything not produced by gmailMime. */
export function inspectSendBody(
  body: unknown,
): {
  subject: string;
  to: string;
  messageId: string;
  payloadHash: string | null;
} | null {
  try {
    if (typeof body !== "string" || body.length > 400000) return null;
    const raw = (JSON.parse(body) as { raw?: unknown }).raw;
    if (typeof raw !== "string" || !/^[A-Za-z0-9_-]+={0,2}$/.test(raw))
      return null;
    const message = Buffer.from(raw, "base64url").toString("utf8");
    const end = message.indexOf("\r\n\r\n");
    if (end < 0) return null;
    const headers = new Map<string, string>();
    for (const line of message
      .slice(0, end)
      .replace(/\r\n[ \t]+/g, " ")
      .split("\r\n")) {
      const colon = line.indexOf(":");
      if (colon <= 0) return null;
      const name = line.slice(0, colon).toLowerCase();
      if (headers.has(name)) return null;
      headers.set(name, line.slice(colon + 1).trim());
    }
    const subject = (headers.get("subject") ?? "")
      .replace(/(=\?UTF-8\?B\?[^?]+\?=)\s+(?==\?UTF-8\?B\?)/gi, "$1")
      .replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_, b) =>
        Buffer.from(b, "base64").toString("utf8"),
      );
    const to = headers.get("to"),
      messageId = headers.get("message-id");
    if (
      !to ||
      !messageId ||
      !/^<awos\.[a-f0-9]{64}@autonomo-os\.invalid>$/.test(messageId)
    )
      return null;
    const payloadHash = headers.get("x-awos-payload-sha256") ?? null;
    if (payloadHash !== null && !/^[a-f0-9]{64}$/.test(payloadHash))
      return null;
    return { subject, to, messageId, payloadHash };
  } catch {
    return null;
  }
}

export interface P01Harness {
  readonly fetcher: typeof fetch;
  /** True until the single shot is consumed (now or in a previous process). */
  armed(): boolean;
  state(): P01State | null;
}

/**
 * Builds the wrapped transport. `log` receives metadata only.
 */
export function createP01ResponseLoss(
  base: typeof fetch,
  armPath: string,
  arm: P01Arm,
  log: (event: string, meta: Record<string, unknown>) => void = () => {},
): P01Harness {
  const statePath = p01StatePath(armPath);
  arm = { ...arm };
  let consumed = existsSync(statePath);
  if (consumed) log("p01.inert", { reason: "ALREADY_CONSUMED" });
  const now = () => new Date().toISOString();
  const fetcher: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    if (consumed || url !== GMAIL_SEND_URL || method !== "POST")
      return base(input, init);
    const inspected = inspectSendBody(init?.body);
    if (
      !inspected ||
      inspected.subject !== arm.subject ||
      inspected.to !== arm.to
    )
      return base(input, init);
    // A cancelled request is left to the normal path and does not spend the shot.
    if (init?.signal?.aborted) return base(input, init);
    const claimedAt = now();
    const state: P01State = {
      version: 1,
      phase: "claimed",
      pid: process.pid,
      processStart: p01ProcessStart(process.pid),
      armHash: p01ArmHash(arm),
      payloadHash: inspected.payloadHash,
      claimedAt,
      updatedAt: claimedAt,
      messageId: inspected.messageId,
      httpStatus: null,
      gmailId: null,
      reason: null,
    };
    try {
      durableWrite(statePath, state, true);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST")
        throw new Error("P01_CLAIM_PERSISTENCE_FAILED");
      // Another process/instance consumed it first: stay inert.
      consumed = true;
      return base(input, init);
    }
    consumed = true;
    log("p01.claimed", { messageId: inspected.messageId });
    let response: Response;
    try {
      response = await base(input, init);
    } catch (error) {
      durableWrite(
        statePath,
        {
          ...state,
          phase: "not_activated",
          updatedAt: now(),
          reason: "TRANSPORT_ERROR",
        },
        false,
      );
      log("p01.not_activated", { reason: "TRANSPORT_ERROR" });
      throw error;
    }
    let text: string;
    try {
      text = await boundedResponse(response);
    } catch (error) {
      durableWrite(
        statePath,
        {
          ...state,
          phase: "not_activated",
          httpStatus: response.status,
          updatedAt: now(),
          reason: "RESPONSE_BODY_UNREADABLE",
        },
        false,
      );
      log("p01.not_activated", {
        reason: "RESPONSE_BODY_UNREADABLE",
        httpStatus: response.status,
      });
      throw error;
    }
    let id: unknown = null;
    try {
      id = (JSON.parse(text) as { id?: unknown }).id;
    } catch {
      id = null;
    }
    const accepted =
      response.status === 200 &&
      typeof id === "string" &&
      /^[-a-zA-Z0-9_]{1,100}$/.test(id);
    if (!accepted) {
      durableWrite(
        statePath,
        {
          ...state,
          phase: "not_activated",
          httpStatus: response.status,
          updatedAt: now(),
          reason: "NO_CONFIRMED_ACCEPTANCE",
        },
        false,
      );
      log("p01.not_activated", {
        reason: "NO_CONFIRMED_ACCEPTANCE",
        httpStatus: response.status,
      });
      // Hand the adapter an equivalent response; acceptance is never invented.
      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }
    durableWrite(
      statePath,
      {
        ...state,
        phase: "response_discarded",
        httpStatus: 200,
        gmailId: id as string,
        updatedAt: now(),
      },
      false,
    );
    log("p01.response_discarded", {
      messageId: inspected.messageId,
      gmailId: id,
    });
    throw new Error(P01_DISCARDED);
  };
  return {
    fetcher,
    armed: () => !consumed,
    state: () => (existsSync(statePath) ? readP01State(armPath) : null),
  };
}
