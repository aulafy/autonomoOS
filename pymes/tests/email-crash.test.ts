import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkspaceRuntime } from "../src/runtime-source.js";
import { FakeEmailProvider } from "../src/email-provider.js";
for (const phase of [
  "after-approval",
  "before-dispatch",
  "during-effect",
  "after-side-effect",
  "lost-response",
])
  test(`SIGKILL ${phase}: durable decision, C12 recovery and read-only reconciliation never resend`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "email-kill-")),
      path = join(dir, "runtime.db");
    const child = fork(
      new URL("./fixtures/email-crash.ts", import.meta.url),
      [path, phase],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    let errors = "";
    child.stderr?.on("data", (d) => (errors += d));
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("TIMEOUT " + errors)),
          10000,
        );
        child.once("message", (msg) => {
          clearTimeout(timer);
          assert.equal(msg, phase);
          resolve();
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error("EARLY_EXIT " + code + " " + errors));
        });
      });
      const exit = once(child, "exit");
      child.kill("SIGKILL");
      await exit;
      const mail = new FakeEmailProvider(path + ".fake-email.db"),
        runtime = await openWorkspaceRuntime(path, "agency", {
          emailProvider: mail,
        });
      try {
        let view = runtime.source.email!.view("job", "owner");
        assert.equal(view.decision?.decision, "approved");
        assert.equal(runtime.kernel.snapshot().tasks.job!.planVersion, 1);
        const sent = ["after-side-effect", "lost-response"].includes(phase)
          ? 1
          : 0;
        assert.deepEqual(mail.counts(), { sent, calls: sent });
        if (phase === "after-approval") {
          assert.equal(view.status, "approved");
          assert.equal(view.effects.length, 0);
        } else if (phase === "before-dispatch") {
          assert.equal(view.status, "failed");
          assert.equal(view.effects[0]?.status, "failed");
        } else {
          assert.equal(view.status, "unknown");
          assert.equal(runtime.kernel.snapshot().tasks.job!.status, "unknown");
          view = await runtime.source.email!.reconcile("job", "owner");
          assert.equal(view.status, sent ? "completed" : "unknown");
          assert.deepEqual(mail.counts(), { sent, calls: sent });
          await runtime.source.email!.reconcile("job", "owner");
          assert.deepEqual(mail.counts(), { sent, calls: sent });
          if (sent) {
            assert.equal(
              runtime.kernel.snapshot().tasks.job!.status,
              "completed",
            );
            assert.equal(
              Object.values(runtime.kernel.snapshot().workUnits).filter(
                (u) => u.status === "succeeded",
              ).length,
              9,
            );
            assert.equal(view.effects[0]?.effective, "committed");
            assert.equal(view.effects[0]?.status, "unknown");
            assert.ok(view.audit.some((a) => a.type === "effect.reconciled"));
            assert.ok(view.audit.some((a) => a.type === "recovery.completed"));
            await runtime.source.email!.execute("job", "owner");
            assert.deepEqual(mail.counts(), { sent, calls: sent });
          }
        }
      } finally {
        runtime.close();
        mail.close();
      }
    } finally {
      child.kill("SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  });
