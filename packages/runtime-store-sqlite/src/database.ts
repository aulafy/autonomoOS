import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deserialize, serialize } from "node:v8";
import { applyMigrations } from "./migrations.js";

export interface StoreCommand {
  sequence: number;
  storeName: string;
  methodName: string;
  occurredAt: number;
  args: unknown[];
  resultDigest: string;
}

function stable(value: unknown): string {
  if (value === undefined) return '"<undefined>"';
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
    typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stable(object[key])}`)
      .join(",")}}`;
  }
  throw new Error("UNSERIALIZABLE_STORE_RESULT");
}
export function digest(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

export class RuntimeDatabase {
  readonly db: DatabaseSync;
  readonly schemaVersion: number;
  private transactionDepth = 0;
  private savepointNumber = 0;

  constructor(readonly path: string, private readonly now: () => number = Date.now) {
    if (!path) throw new Error("SQLITE_PATH_REQUIRED");
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA synchronous = FULL");
      this.db.exec("PRAGMA foreign_keys = ON");
      this.db.exec("PRAGMA busy_timeout = 5000");
      const check = this.db.prepare("PRAGMA integrity_check").get() as
        Record<string, string> | undefined;
      if (!check || Object.values(check)[0] !== "ok") throw new Error("SQLITE_INTEGRITY_FAILURE");
      this.schemaVersion = applyMigrations(this.db, now);
      this.verifySchema();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  transaction<T>(work: () => T): T {
    const nested = this.transactionDepth > 0;
    const name = `h1_sp_${++this.savepointNumber}`;
    this.db.exec(nested ? `SAVEPOINT ${name}` : "BEGIN IMMEDIATE");
    this.transactionDepth++;
    try {
      const result = work();
      if (result instanceof Promise) throw new Error("ASYNC_SQLITE_TRANSACTION_FORBIDDEN");
      this.db.exec(nested ? `RELEASE SAVEPOINT ${name}` : "COMMIT");
      return result;
    } catch (error) {
      this.db.exec(nested ? `ROLLBACK TO SAVEPOINT ${name}; RELEASE SAVEPOINT ${name}` : "ROLLBACK");
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }

  appendCommand(storeName: string, methodName: string, args: unknown[],
    result: unknown): number {
    if (!storeName || !methodName || !Array.isArray(args)) {
      throw new Error("INVALID_STORE_COMMAND");
    }
    const write = () => {
      const info = this.db.prepare(`INSERT INTO store_commands
        (store_name, method_name, occurred_at, args, result_digest)
        VALUES (?, ?, ?, ?, ?)`).run(storeName, methodName, this.now(),
        serialize(args), digest(result));
      return Number(info.lastInsertRowid);
    };
    return this.transactionDepth ? write() : this.transaction(write);
  }

  commands(): StoreCommand[] {
    const rows = this.db.prepare(`SELECT sequence, store_name, method_name, occurred_at,
      args, result_digest FROM store_commands ORDER BY sequence`).all() as unknown as {
      sequence: number; store_name: string; method_name: string; occurred_at: number;
      args: Uint8Array; result_digest: string;
    }[];
    return rows.map(row => ({ sequence: row.sequence, storeName: row.store_name,
      methodName: row.method_name, occurredAt: row.occurred_at,
      args: deserialize(row.args) as unknown[], resultDigest: row.result_digest }));
  }

  appendRuntimeEvent(event: { id: string; timestamp: number; [key: string]: unknown }): number {
    const write = () => {
      const info = this.db.prepare(`INSERT INTO runtime_events
        (event_id, occurred_at, event_json) VALUES (?, ?, ?)`).run(
        event.id, event.timestamp, JSON.stringify(event));
      return Number(info.lastInsertRowid);
    };
    return this.transactionDepth ? write() : this.transaction(write);
  }

  runtimeEvents(): Record<string, unknown>[] {
    const rows = this.db.prepare("SELECT event_json FROM runtime_events ORDER BY sequence")
      .all() as { event_json: string }[];
    return rows.map(row => JSON.parse(row.event_json) as Record<string, unknown>);
  }

  setProjectionDigest(name: string, sourceSequence: number, value: string): void {
    this.db.prepare(`INSERT INTO projection_digests
      (projection_name, source_sequence, digest, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(projection_name) DO UPDATE SET
        source_sequence = excluded.source_sequence,
        digest = excluded.digest,
        updated_at = excluded.updated_at`).run(name, sourceSequence, value, this.now());
  }

  projectionDigests(): Map<string, { sequence: number; digest: string }> {
    const rows = this.db.prepare(`SELECT projection_name, source_sequence, digest
      FROM projection_digests`).all() as { projection_name: string;
      source_sequence: number; digest: string }[];
    return new Map(rows.map(row => [row.projection_name,
      { sequence: row.source_sequence, digest: row.digest }]));
  }

  verifySchema(): void {
    const expected = ["projection_digests", "runtime_events", "schema_migrations", "store_commands"];
    const rows = this.db.prepare(`SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as
      { name: string }[];
    if (JSON.stringify(rows.map(row => row.name)) !== JSON.stringify(expected)) {
      throw new Error("SQLITE_SCHEMA_INCOMPATIBLE");
    }
  }

  close(): void { this.db.close(); }
}
