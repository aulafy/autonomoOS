import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
export type CliResult =
  | { status: "completed"; exitCode: number; stdout: string }
  | { status: "start-failed" | "timeout" | "output-limit" | "terminated"; reason: string };
export interface CliTransport { call(args: readonly string[]): Promise<CliResult> }
export class OrcaCliTransport implements CliTransport {
  constructor(private executable: string, private options: { prefixArgs?: string[]; cwd?: string; timeoutMs?: number; maxOutputBytes?: number } = {}) {
    if (!isAbsolute(executable) || /[\u0000-\u001f]/.test(executable)) throw new Error("ABSOLUTE_ORCA_EXECUTABLE_REQUIRED");
    const timeout = options.timeoutMs ?? 10000, limit = options.maxOutputBytes ?? 1_048_576;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60000 || !Number.isInteger(limit) || limit < 1 || limit > 4_194_304) throw new Error("INVALID_TRANSPORT_LIMIT");
  }
  async call(args: readonly string[]): Promise<CliResult> {
    const argv = [...(this.options.prefixArgs ?? []), ...args];
    if (argv.some(arg => typeof arg !== "string" || arg.includes("\0"))) throw new Error("INVALID_CLI_ARGUMENT");
    const environment: NodeJS.ProcessEnv = {};
    for (const name of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL"]) if (process.env[name]) environment[name] = process.env[name];
    return new Promise(resolve => {
      const child = spawn(this.executable, argv, { shell: false, cwd: this.options.cwd,
        env: environment, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
      const stdout: Buffer[] = []; let bytes = 0, finished = false;
      let hardKill: ReturnType<typeof setTimeout> | undefined;
      const terminate = (signal: NodeJS.Signals) => {
        try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, signal); else child.kill(signal); } catch { /* already exited */ }
      };
      const finish = (result: CliResult, stop = false) => {
        if (finished) return; finished = true; clearTimeout(timer);
        if (stop) {
          terminate("SIGTERM");
          hardKill = setTimeout(() => terminate("SIGKILL"), 250); hardKill.unref();
          child.stdout.destroy(); child.stderr.destroy();
        }
        resolve(result);
      };
      const timer = setTimeout(() => finish({ status: "timeout", reason: "orca_cli_timeout" }, true), this.options.timeoutMs ?? 10000);
      const capture = (chunk: Buffer, output: boolean) => {
        if (finished) return;
        bytes += chunk.length;
        if (bytes > (this.options.maxOutputBytes ?? 1_048_576)) return finish({ status: "output-limit", reason: "orca_cli_output_limit" }, true);
        if (output) stdout.push(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => capture(chunk, true));
      child.stderr.on("data", (chunk: Buffer) => capture(chunk, false));
      child.on("error", () => finish({ status: "start-failed", reason: "orca_cli_unavailable" }));
      child.on("close", (code, signal) => {
        // A parent can exit on SIGTERM while a descendant ignores it. Keep the
        // group escalation scheduled after a stopped call even if close fires.
        if (hardKill && !finished) clearTimeout(hardKill);
        if (signal || code === null) finish({ status: "terminated", reason: "orca_cli_terminated" });
        else finish({ status: "completed", exitCode: code, stdout: Buffer.concat(stdout).toString("utf8") });
      });
    });
  }
}
