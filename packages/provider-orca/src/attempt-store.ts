import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import type { PrepareExecutionInput, ProviderExecutionRef, DispatchReceipt, ProviderSignal, ProviderMessage, SendReceipt } from "@agent-world/execution-providers";
export interface OrcaPlacement { worktree: string; agent: string; coordinator: string; spec: string }
export interface OrcaAttemptRecord {
  input: PrepareExecutionInput; placement: OrcaPlacement; handle: string;
  runRequestId: string; workerRequestId: string;
  state: "prepared" | "dispatching" | "dispatched" | "unknown";
  runId?: string; ref?: ProviderExecutionRef; receipt?: DispatchReceipt;
}
export interface OrcaReplyRecord { attemptId: string; message: ProviderMessage; requestId: string; state: "sending" | "accepted" | "unknown"; receipt?: SendReceipt }
/** Provider-local recovery cache. Global lifecycle truth stays in the AW2 journal. */
export class OrcaAttemptStore {
  private database: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS aw2_orca_attempts (handle TEXT PRIMARY KEY, attempt_id TEXT UNIQUE NOT NULL, input_json TEXT NOT NULL, record_json TEXT NOT NULL)");
    this.database.exec("CREATE TABLE IF NOT EXISTS aw2_orca_signals (id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, signal_json TEXT NOT NULL)");
    this.database.exec("CREATE TABLE IF NOT EXISTS aw2_orca_replies (attempt_id TEXT NOT NULL, question_id TEXT NOT NULL, reply_json TEXT NOT NULL, PRIMARY KEY(attempt_id, question_id))");
  }
  get(handle: string): OrcaAttemptRecord | undefined {
    const row = this.database.prepare("SELECT record_json FROM aw2_orca_attempts WHERE handle=?").get(handle) as { record_json: string } | undefined;
    if (!row) return undefined;
    const record = JSON.parse(row.record_json) as OrcaAttemptRecord;
    if (record.handle !== handle || !["prepared", "dispatching", "dispatched", "unknown"].includes(record.state)) throw new Error("ORCA_STORE_CORRUPT");
    return record;
  }
  create(record: OrcaAttemptRecord): OrcaAttemptRecord {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(record.handle);
      if (current) {
        if (JSON.stringify(current.input) !== JSON.stringify(record.input) || JSON.stringify(current.placement) !== JSON.stringify(record.placement)) throw new Error("ORCA_ATTEMPT_ID_CONFLICT");
        this.database.exec("COMMIT"); return current;
      }
      this.database.prepare("INSERT INTO aw2_orca_attempts VALUES (?, ?, ?, ?)").run(record.handle, record.input.attemptId, JSON.stringify(record.input), JSON.stringify(record));
      this.database.exec("COMMIT"); return structuredClone(record);
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  /** Exclusive compare-and-set claim prevents competing hosts from dispatching twice. */
  claim(handle: string): boolean {
    const result = this.database.prepare("UPDATE aw2_orca_attempts SET record_json=json_set(record_json,'$.state','dispatching') WHERE handle=? AND json_extract(record_json,'$.state')='prepared'").run(handle);
    return result.changes === 1;
  }
  save(record: OrcaAttemptRecord): void {
    const result = this.database.prepare("UPDATE aw2_orca_attempts SET record_json=? WHERE handle=? AND attempt_id=?").run(JSON.stringify(record), record.handle, record.input.attemptId);
    if (result.changes !== 1) throw new Error("ORCA_ATTEMPT_NOT_FOUND");
  }
  close(): void { this.database.close(); }
  rememberSignals(signals: ProviderSignal[]): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const signal of signals) {
        const row = this.database.prepare("SELECT signal_json FROM aw2_orca_signals WHERE id=?").get(signal.id) as { signal_json: string } | undefined;
        if (row) {
          const previous = JSON.parse(row.signal_json) as ProviderSignal;
          if (JSON.stringify({ ...previous, observedAt: 0 }) !== JSON.stringify({ ...signal, observedAt: 0 })) throw new Error("ORCA_SIGNAL_ID_CONFLICT");
        } else this.database.prepare("INSERT INTO aw2_orca_signals VALUES (?, ?, ?)").run(signal.id, signal.attemptId, JSON.stringify(signal));
      }
      this.database.exec("COMMIT");
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  signals(attemptId: string): ProviderSignal[] {
    const rows = this.database.prepare("SELECT signal_json FROM aw2_orca_signals WHERE attempt_id=? ORDER BY id").all(attemptId) as { signal_json: string }[];
    return rows.map(row => JSON.parse(row.signal_json) as ProviderSignal);
  }
  reply(attemptId: string, questionId: string): OrcaReplyRecord | undefined {
    const row = this.database.prepare("SELECT reply_json FROM aw2_orca_replies WHERE attempt_id=? AND question_id=?").get(attemptId, questionId) as { reply_json: string } | undefined;
    return row ? JSON.parse(row.reply_json) as OrcaReplyRecord : undefined;
  }
  claimReply(reply: OrcaReplyRecord): boolean {
    return this.database.prepare("INSERT OR IGNORE INTO aw2_orca_replies VALUES (?, ?, ?)").run(reply.attemptId, reply.message.inReplyTo!, JSON.stringify(reply)).changes === 1;
  }
  saveReply(reply: OrcaReplyRecord): void {
    const result = this.database.prepare("UPDATE aw2_orca_replies SET reply_json=? WHERE attempt_id=? AND question_id=?").run(JSON.stringify(reply), reply.attemptId, reply.message.inReplyTo!);
    if (result.changes !== 1) throw new Error("ORCA_REPLY_NOT_FOUND");
  }
}
