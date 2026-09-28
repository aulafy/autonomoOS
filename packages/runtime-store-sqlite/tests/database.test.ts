import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { RuntimeDatabase, SCHEMA_VERSION } from "../src/index.js";

function temporary<T>(run: (path: string) => T): T {
  const directory = mkdtempSync(join(tmpdir(), "agent-world-h1-"));
  try { return run(join(directory, "runtime.db")); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test("new database initializes WAL/FULL/foreign keys and reopens at stable migration", () => {
  temporary(path => {
    const first = new RuntimeDatabase(path, () => 100);
    assert.equal(first.schemaVersion, SCHEMA_VERSION);
    assert.equal((first.db.prepare("PRAGMA journal_mode").get() as
      { journal_mode: string }).journal_mode, "wal");
    assert.equal((first.db.prepare("PRAGMA synchronous").get() as
      { synchronous: number }).synchronous, 2);
    assert.equal((first.db.prepare("PRAGMA foreign_keys").get() as
      { foreign_keys: number }).foreign_keys, 1);
    first.appendCommand("effects", "create", [{ id: "e1", optional: undefined }], { version: 1 });
    first.appendRuntimeEvent({ id: "event-1", timestamp: 100, type: "effect.created" });
    first.close();
    const reopened = new RuntimeDatabase(path, () => 200);
    assert.equal(reopened.schemaVersion, SCHEMA_VERSION);
    assert.equal(reopened.commands().length, 1);
    assert.equal((reopened.commands()[0]!.args[0] as { optional?: unknown }).optional, undefined);
    assert.equal(reopened.runtimeEvents().length, 1);
    assert.equal(reopened.exportRuntimeEventsJsonl(join(path, "../events.jsonl")), 1);
    assert.deepEqual(readFileSync(join(path, "../events.jsonl"), "utf8").trim().split("\n")
      .map(line => JSON.parse(line)), reopened.runtimeEvents());
    assert.equal((reopened.db.prepare("SELECT count(*) AS count FROM schema_migrations")
      .get() as { count: number }).count, SCHEMA_VERSION);
    reopened.close();
  });
});

test("transaction rolls back all commands and events, including nested savepoint", () => {
  temporary(path => {
    const database = new RuntimeDatabase(path);
    assert.throws(() => database.transaction(() => {
      database.appendCommand("effects", "create", [{ id: "e1" }], { id: "e1" });
      database.transaction(() => database.appendRuntimeEvent({
        id: "event-1", timestamp: 100, type: "effect.created" }));
      throw new Error("injected failure");
    }), /injected failure/);
    assert.equal(database.commands().length, 0);
    assert.equal(database.runtimeEvents().length, 0);
    database.close();
  });
});

test("unknown migration or corrupt schema fails closed", () => {
  temporary(path => {
    const database = new RuntimeDatabase(path);
    database.close();
    const raw = new DatabaseSync(path);
    raw.exec("DROP TABLE store_commands");
    raw.close();
    assert.throws(() => new RuntimeDatabase(path), /SQLITE_SCHEMA_INCOMPATIBLE/);
  });
  temporary(path => {
    const raw = new DatabaseSync(path);
    raw.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)");
    raw.exec("INSERT INTO schema_migrations VALUES (99, 1)");
    raw.close();
    assert.throws(() => new RuntimeDatabase(path), /SQLITE_SCHEMA_INCOMPATIBLE/);
  });
});
