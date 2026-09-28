import type { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 2;

interface Migration { version: number; sql: string; }
const migrations: readonly Migration[] = [
  { version: 1, sql: `
    CREATE TABLE store_commands (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      store_name TEXT NOT NULL,
      method_name TEXT NOT NULL,
      occurred_at INTEGER NOT NULL,
      args BLOB NOT NULL,
      result_digest TEXT NOT NULL
    );
    CREATE INDEX idx_store_commands_name_sequence
      ON store_commands(store_name, sequence);
    CREATE TABLE runtime_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      occurred_at INTEGER NOT NULL,
      event_json TEXT NOT NULL
    );
    CREATE TABLE projection_digests (
      projection_name TEXT PRIMARY KEY,
      source_sequence INTEGER NOT NULL,
      digest TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  ` },
  { version: 2, sql: `
    CREATE INDEX idx_runtime_events_task_sequence
      ON runtime_events(json_extract(event_json, '$.taskId'), sequence);
    CREATE INDEX idx_runtime_events_type_sequence
      ON runtime_events(json_extract(event_json, '$.type'), sequence);
  ` }
];

export function applyMigrations(db: DatabaseSync, now: () => number): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  const rows = db.prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all() as { version: number }[];
  const known = rows.map(row => row.version);
  if (known.some((version, index) => version !== index + 1) ||
    known.some(version => version > SCHEMA_VERSION)) {
    throw new Error("SQLITE_SCHEMA_INCOMPATIBLE");
  }
  for (const migration of migrations) {
    if (known.includes(migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
        .run(migration.version, now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return SCHEMA_VERSION;
}
