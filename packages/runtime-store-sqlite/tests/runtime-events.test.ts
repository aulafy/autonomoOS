import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DurableRuntimeEventPublisher, RuntimeDatabase } from "../src/index.js";

test("notifications wait for the outer commit and rollback publishes nothing", () => {
  const directory = mkdtempSync(join(tmpdir(), "h11-events-"));
  try {
    const database = new RuntimeDatabase(join(directory, "runtime.db"), () => 100);
    const notifications: string[] = [];
    const publisher = new DurableRuntimeEventPublisher(database,
      event => notifications.push(event.id));
    database.transaction(() => {
      publisher.append({ id: "a", timestamp: 100 });
      database.transaction(() => publisher.append({ id: "b", timestamp: 100 }));
      assert.deepEqual(notifications, []);
      assert.equal(database.runtimeEvents().length, 2);
    });
    assert.deepEqual(notifications, ["a", "b"]);
    assert.throws(() => database.transaction(() => {
      publisher.append({ id: "rolled-back", timestamp: 100 });
      throw new Error("rollback");
    }), /rollback/);
    assert.deepEqual(notifications, ["a", "b"]);
    assert.deepEqual(database.runtimeEvents().map(event => event.id), ["a", "b"]);
    database.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("committed event remains replayable when live delivery is lost or duplicated", () => {
  const directory = mkdtempSync(join(tmpdir(), "h11-replay-"));
  const path = join(directory, "runtime.db");
  try {
    const database = new RuntimeDatabase(path, () => 100);
    const notifications: string[] = [];
    const publisher = new DurableRuntimeEventPublisher(database,
      event => notifications.push(event.id));
    publisher.append({ id: "durable", timestamp: 100 });
    notifications.push("durable"); // A transport may deliver twice.
    assert.deepEqual(notifications, ["durable", "durable"]);
    assert.equal(database.runtimeEvents().length, 1);
    database.close();
    const reopened = new RuntimeDatabase(path, () => 200);
    assert.deepEqual(reopened.runtimeEvents().map(event => event.id), ["durable"]);
    reopened.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("SIGKILL between commit and publication leaves the event available for replay", () => {
  const directory = mkdtempSync(join(tmpdir(), "h11-kill-"));
  const path = join(directory, "runtime.db");
  try {
    const fixture = fileURLToPath(new URL("./fixtures/kill-after-commit.ts", import.meta.url));
    const child = spawnSync(process.execPath, ["--import", "tsx", fixture, path], {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)), encoding: "utf8",
      timeout: 15000 });
    assert.equal(child.signal, "SIGKILL", child.stderr);
    const reopened = new RuntimeDatabase(path, () => 200);
    assert.deepEqual(reopened.runtimeEvents().map(event => event.id),
      ["committed-before-delivery"]);
    reopened.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
