import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  loadP01Arm,
  readP01State,
  p01ArmHash,
  p01ProcessStart,
  type P01Arm,
  type P01State,
} from "./gmail-fault-injection.js";
import { parseEmailView } from "./email-view.js";
import { effectIdempotencyKey } from "@agent-world/effects";
import { mintResourceId } from "@agent-world/resources";
import { gmailMessageId } from "./gmail-mime.js";

// The API returns the projection at its root. Do not guess wrapped response shapes.
export function findEmailStatus(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return typeof v.status === "string" && Array.isArray(v.effects)
    ? v.status
    : null;
}
/** Correlate the durable UNKNOWN projection to the exact MIME selected by P01.
 * Uses existing C6 key generation, not a new authority or execution path. */
export function confirmsP01Unknown(
  value: unknown,
  arm: P01Arm,
  state: P01State,
  taskId: string,
): boolean {
  try {
    const view = parseEmailView(value, arm.tenant, taskId),
      r = view.review;
    if (
      view.status !== "unknown" ||
      !r ||
      r.owner !== arm.owner ||
      r.provider !== "gmail-email" ||
      r.payload.subject !== arm.subject ||
      r.payload.to.length !== 1 ||
      r.payload.to[0] !== arm.to ||
      r.payloadHash !== state.payloadHash ||
      state.armHash !== p01ArmHash(arm) ||
      !view.effects.some(
        (e) => e.status === "unknown" && e.effective === "unknown",
      )
    )
      return false;
    const key = effectIdempotencyKey({
      taskId: r.taskId,
      intentId: `email:${r.bindingHash}`,
      action: "email.send",
      resourceIds: [
        mintResourceId("sink_email", `simulated/${r.owner}/${r.bindingHash}`),
      ],
      parameters: r.payload,
      executorId: "email-provider",
    });
    return gmailMessageId(key) === state.messageId;
  } catch {
    return false;
  }
}
export interface P01KillOptions {
  armPath: string;
  taskId: string;
  tenant: string;
  token: string;
  port: number;
}
export interface P01Process {
  start: string;
  command: string;
  listening: boolean;
}
export interface P01KillDependencies {
  process(pid: number, port: number): P01Process;
  fetcher: typeof fetch;
  kill(pid: number): void;
  wait(): Promise<void>;
}
function inspectProcess(pid: number, port: number): P01Process {
  try {
    const command = execFileSync(
      "/bin/ps",
      ["-p", String(pid), "-o", "command="],
      { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    // macOS pilot: confirm this PID, not another instance, owns the API socket.
    const sockets = execFileSync(
      "/usr/sbin/lsof",
      ["-nP", "-a", "-p", String(pid), "-iTCP:" + port, "-sTCP:LISTEN", "-Fpn"],
      { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
    );
    return {
      start: p01ProcessStart(pid),
      command,
      listening:
        sockets.split("\n").includes("p" + pid) &&
        sockets.includes("n127.0.0.1:" + port),
    };
  } catch {
    throw new Error("P01_KILL_PROCESS_NOT_CONFIRMED");
  }
}
function assertProcess(state: P01State, process: P01Process) {
  if (
    state.pid <= 1 ||
    state.pid === globalThis.process.pid ||
    state.processStart !== process.start ||
    !/(?:^|\s)(?:[^\s]*\/)?src\/server\.ts(?:\s|$)/.test(process.command) ||
    !process.listening
  )
    throw new Error("P01_KILL_PID_NOT_PILOT_API");
}
/** Dependency seam permits safety tests without sending signals to real APIs. */
export async function killP01Pilot(
  options: P01KillOptions,
  deps: P01KillDependencies = {
    process: inspectProcess,
    fetcher: fetch,
    kill: (pid) => process.kill(pid, "SIGKILL"),
    wait: () => new Promise((resolve) => setTimeout(resolve, 500)),
  },
) {
  const { armPath, taskId, tenant, token, port } = options;
  if (
    !armPath ||
    !taskId ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(taskId) ||
    !tenant ||
    tenant.length > 200 ||
    token.length < 16 ||
    token.length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(token) ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535
  )
    throw new Error("P01_KILL_INVALID_OPTIONS");
  const state = readP01State(armPath);
  if (
    !state ||
    state.phase !== "response_discarded" ||
    state.httpStatus !== 200 ||
    !state.gmailId ||
    !state.payloadHash
  )
    throw new Error("P01_KILL_NOT_FIRED");
  let arm: P01Arm;
  try {
    if (statSync(armPath).size > 4096) throw 0;
    const rawArm = JSON.parse(readFileSync(armPath, "utf8"));
    arm = loadP01Arm(armPath, { tenant, owner: rawArm.owner });
  } catch {
    throw new Error("P01_KILL_ARM_INVALID");
  }
  if (p01ArmHash(arm) !== state.armHash)
    throw new Error("P01_KILL_ARM_MISMATCH");
  assertProcess(state, deps.process(state.pid, port));
  const url = `http://127.0.0.1:${port}/v1/workspaces/${encodeURIComponent(tenant)}/runtime/${encodeURIComponent(taskId)}/email`;
  const deadline = Date.now() + 30000;
  let confirmed = false;
  while (Date.now() < deadline) {
    const response = await deps.fetcher(url, {
      headers: { Authorization: "Bearer " + token },
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
    if (response.status !== 200) throw new Error("P01_KILL_API_NOT_CONFIRMED");
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 200000) throw new Error("P01_KILL_RESPONSE_INVALID");
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (confirmsP01Unknown(value, arm, state, taskId)) {
      confirmed = true;
      break;
    }
    if (findEmailStatus(value) !== "running")
      throw new Error("P01_KILL_UNKNOWN_NOT_CONFIRMED");
    await deps.wait();
  }
  if (!confirmed) throw new Error("P01_KILL_UNKNOWN_NOT_CONFIRMED");
  // Recheck immediately before signaling to reject stale/reused PIDs or changed metadata.
  const latest = readP01State(armPath);
  if (!latest || JSON.stringify(latest) !== JSON.stringify(state))
    throw new Error("P01_KILL_STATE_CHANGED");
  assertProcess(state, deps.process(state.pid, port));
  deps.kill(state.pid);
  return {
    killed: state.pid,
    messageId: state.messageId,
    gmailId: state.gmailId,
    at: new Date().toISOString(),
  };
}
if (process.argv[1]?.endsWith("p01-pilot-kill.ts")) {
  const [armPath, taskId] = process.argv.slice(2);
  killP01Pilot({
    armPath: armPath ?? "",
    taskId: taskId ?? "",
    tenant: process.env.PYMES_API_BOOTSTRAP_TENANT ?? "",
    token: process.env.PYMES_API_BOOTSTRAP_TOKEN ?? "",
    port: Number(process.env.PYMES_API_PORT ?? 8790),
  })
    .then((value) => console.log(JSON.stringify(value)))
    .catch(() => {
      console.error("P01_KILL_REFUSED_OR_UNCONFIRMED");
      process.exitCode = 1;
    });
}
