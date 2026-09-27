import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { FilesystemWorkspace } from "@agent-world/filesystem";
import { createDurableDomainStores, JournalKernel, ReplayClock,
  RuntimeDatabase } from "@agent-world/runtime-store-sqlite";
import { WorldRuntime } from "@agent-world/world-core";
import { createDemoControlPlane } from "../src/demo-control-plane.js";

const fixture = fileURLToPath(new URL("./fixtures/kill-filesystem-write.ts", import.meta.url));

test("real filesystem SIGKILL windows A-E reconcile disk without rewriting", async () => {
  for (const window of "ABCDE") {
    const directory = mkdtempSync(join(tmpdir(), `h2-crash-${window}-`));
    const root = join(directory, "workspace");
    mkdirSync(root);
    const path = join(directory, "runtime.db");
    const target = join(root, "hello.txt");
    try {
      const child = spawnSync(process.execPath,
        ["--import", "tsx", fixture, path, root, window], {
          cwd: fileURLToPath(new URL("../../..", import.meta.url)),
          encoding: "utf8", timeout: 15000 });
      assert.equal(child.signal, "SIGKILL", `${window}: ${child.stderr}`);
      const before = existsSync(target) ? readFileSync(target) : null;
      const clock = new ReplayClock();
      const database = new RuntimeDatabase(path, clock.now);
      const kernel = new JournalKernel(database, clock);
      const stores = createDurableDomainStores(kernel);
      await kernel.restore();
      const filesystem = new FilesystemWorkspace(root, stores.resources);
      const control = createDemoControlPlane(new WorldRuntime(), event =>
        database.appendRuntimeEvent(event), { kernel, stores, filesystem });
      control.recoverOnStartup();
      if (window === "A") {
        assert.equal(stores.effects.list()[0]?.status, "failed");
        assert.equal(before, null);
      } else if (window === "E") {
        assert.equal(stores.effects.list()[0]?.status, "committed");
        assert.equal(stores.budgets.listReservations()[0]?.status, "committed");
      } else {
        assert.equal(stores.effects.list()[0]?.status, "unknown");
        assert.equal(stores.budgets.listReservations()[0]?.status, "active");
        await control.reconcilePendingFilesystem();
        if (window === "B") {
          assert.equal(stores.effects.list()[0]?.status, "unknown");
          assert.equal(before, null);
        } else {
          assert.equal(stores.effects.list()[0]?.status, "committed");
          assert.equal(stores.budgets.listReservations()[0]?.status, "committed");
        }
      }
      assert.deepEqual(existsSync(target) ? readFileSync(target) : null, before,
        `window ${window} rewrote file during recovery`);
      if (before) assert.equal(before.toString("utf8"), "Hello from Agent World OS");
      database.close();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});
