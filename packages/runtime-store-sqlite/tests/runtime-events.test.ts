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

test("operator queries preserve sequence order and bound results across reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "h11-operator-"));
  const path = join(directory, "runtime.db");
  try {
    const database = new RuntimeDatabase(path);
    database.appendRuntimeEvent({ id: "a", timestamp: 100, type: "action.proposed",
      taskId: "task-a" });
    database.appendRuntimeEvent({ id: "b", timestamp: 100, type: "policy.denied",
      taskId: "task-b", payload: { reason: "POLICY_DENIED" } });
    database.appendRuntimeEvent({ id: "c", timestamp: 100, type: "control.event",
      taskId: "task-a", payload: { controlEventType: "action.commit_denied" } });
    database.appendRuntimeEvent({ id: "d", timestamp: 100, type: "action.proposed",
      taskId: "task-a" });
    assert.deepEqual(database.runtimeEventsByTask("task-a", 2).map(e => e.id), ["c", "d"]);
    assert.deepEqual(database.recentDenialEvents(1).map(e => e.id), ["c"]);
    database.close();
    const reopened = new RuntimeDatabase(path);
    assert.equal(reopened.schemaVersion, 2);
    assert.deepEqual(reopened.runtimeEventsByTask("task-a").map(e => e.id), ["a", "c", "d"]);
    assert.deepEqual(reopened.recentDenialEvents().map(e => e.id), ["b", "c"]);
    reopened.close();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("version one journal upgrades operator indexes without changing events", () => {
  const directory = mkdtempSync(join(tmpdir(), "h11-upgrade-"));
  const path = join(directory, "runtime.db");
  try {
    const first = new RuntimeDatabase(path);
    first.appendRuntimeEvent({ id: "before-upgrade", timestamp: 100,
      type: "policy.denied", taskId: "task-a", payload: {} });
    first.db.exec(`DROP INDEX idx_runtime_events_task_sequence;
      DROP INDEX idx_runtime_events_type_sequence;
      DELETE FROM schema_migrations WHERE version = 2`);
    first.close();
    const upgraded = new RuntimeDatabase(path);
    assert.equal(upgraded.schemaVersion, 2);
    assert.deepEqual(upgraded.recentDenialEvents().map(e => e.id), ["before-upgrade"]);
    assert.deepEqual(upgraded.runtimeEventsByTask("task-a").map(e => e.id),
      ["before-upgrade"]);
    upgraded.close();
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
