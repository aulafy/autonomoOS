import { spawn } from "node:child_process";
import { resolve } from "node:path";
export interface CredentialVault {
  get(ref: string): Promise<string | null>;
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
}
/** Native helper is compiled at installation. Failure never falls back to a file. */
export class MacKeychainVault implements CredentialVault {
  constructor(private helper: string) {
    if (process.platform !== "darwin" || !helper || !helper.startsWith("/"))
      throw new Error("MAC_KEYCHAIN_REQUIRED");
    this.helper = resolve(helper);
  }
  private run(
    operation: "get" | "set" | "delete",
    ref: string,
    value?: string,
  ): Promise<string | null> {
    if (!/^[a-f0-9]{64}$/.test(ref))
      throw new Error("INVALID_CREDENTIAL_REFERENCE");
    return new Promise((resolve, reject) => {
      const child = spawn(this.helper, [operation, ref], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { PATH: "/usr/bin:/bin" },
      });
      let output = Buffer.alloc(0),
        settled = false;
      const finish = (error?: Error, result: string | null = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : resolve(result);
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new Error("KEYCHAIN_OPERATION_FAILED"));
      }, 15000);
      child.stdout.on("data", (chunk) => {
        output = Buffer.concat([output, chunk]);
        if (output.length > 65536) {
          child.kill("SIGKILL");
          finish(new Error("KEYCHAIN_OPERATION_FAILED"));
        }
      });
      child.stderr.resume();
      child.on("error", () => finish(new Error("KEYCHAIN_OPERATION_FAILED")));
      child.stdin.on("error", () =>
        finish(new Error("KEYCHAIN_OPERATION_FAILED")),
      );
      child.on("close", (code) =>
        finish(
          code === 0 || (operation === "get" && code === 3)
            ? undefined
            : new Error("KEYCHAIN_OPERATION_FAILED"),
          code === 3
            ? null
            : operation === "get"
              ? output.toString("utf8")
              : null,
        ),
      );
      child.stdin.end(value ?? "");
    });
  }
  get(ref: string) {
    return this.run("get", ref);
  }
  async set(ref: string, value: string) {
    await this.run("set", ref, value);
  }
  async delete(ref: string) {
    await this.run("delete", ref);
  }
}
