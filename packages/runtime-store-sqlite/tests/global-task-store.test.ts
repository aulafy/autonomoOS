import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { RuntimeDatabase, JournalKernel, ReplayClock, createDurableTaskRuntime, createDurableDomainStores } from "../src/index.js";

test("AW2 DAG, active attempt, provider refs, decision/evidence and UNKNOWN survive real SIGKILL", () => {
  const folder = mkdtempSync(join(tmpdir(), "aw2-crash-"));
  const driver = fileURLToPath(new URL("./fixtures/aw2-crash.ts", import.meta.url));
  try {
    const database = join(folder, "runtime.db"), before = join(folder, "before.json"), after = join(folder, "after.json");
    const killed = spawnSync(process.execPath, ["--import", "tsx", driver, "write", database, before], { encoding: "utf8", timeout: 10000 });
    assert.equal(killed.signal, "SIGKILL", killed.stderr);
    const restored = spawnSync(process.execPath, ["--import", "tsx", driver, "read", database, after], { encoding: "utf8", timeout: 10000 });
    assert.equal(restored.status, 0, restored.stderr);
    const snapshot = JSON.parse(readFileSync(after, "utf8"));
    assert.deepEqual(snapshot, JSON.parse(readFileSync(before, "utf8")));
    assert.equal(snapshot.tasks.task.status, "unknown");
    assert.deepEqual(snapshot.workUnits.w2.dependencies, ["w1"]);
    assert.equal(snapshot.workUnits.w1.activeAttemptId, "a1");
    assert.equal(snapshot.attempts.a1.providerExecutionRef.externalAttemptId, "dispatch1");
    assert.equal(snapshot.references.length, 2);
    assert.deepEqual(snapshot.providerSignals.map((signal: { providerMessageId: string }) => signal.providerMessageId), ["question1", "escalation1"]);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

test("AW2 registration coexists with legacy durable tasks without changing their journal", async () => {
  const database = new RuntimeDatabase(":memory:");
  try {
    const journal = new JournalKernel(database, new ReplayClock(() => 100));
    const legacy = createDurableDomainStores(journal);
    const global = createDurableTaskRuntime(journal);
    await journal.restore();
    legacy.tasks.create({ id: "legacy", principalId: "owner", createdAt: 100 });
    global.apply({ id: "event", taskId: "global", at: 100, type: "GlobalTaskCreated", goal: "goal", owner: "owner", successCriteria: [{ id: "criterion", kind: "custom", input: null, verifierId: "host" }] }, 0);
    await journal.restore();
    assert.equal(legacy.tasks.get("legacy")?.status, "running");
    assert.equal(global.snapshot().tasks.global!.status, "created");
    assert.equal(database.commands().length, 2);
  } finally { database.close(); }
});
