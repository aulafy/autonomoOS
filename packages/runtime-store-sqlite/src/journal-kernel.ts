import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { digest, RuntimeDatabase } from "./database.js";

export class ReplayClock {
  private replayAt: number | null = null;
  private readonly operationAt = new AsyncLocalStorage<number>();
  constructor(private readonly liveNow: () => number = Date.now) {}
  now = (): number => this.operationAt.getStore() ?? this.replayAt ?? this.liveNow();
  at(value: number | null): void { this.replayAt = value; }
  runAt<T>(value: number, work: () => T): T { return this.operationAt.run(value, work); }
}

interface Entry { name: string; factory: () => object; inner: object;
  mutators: ReadonlySet<string>; }

function chain(previous: string, sequence: number, resultDigest: string): string {
  return createHash("sha256").update(`${previous}:${sequence}:${resultDigest}`).digest("hex");
}

/** SQLite command log is authoritative; domain stores are replayed projections. */
export class JournalKernel {
  private readonly entries = new Map<string, Entry>();
  private readonly hashes = new Map<string, { sequence: number; digest: string }>();
  private restored = false;
  private healthy = true;
  private mutationCount = 0;

  constructor(readonly database: RuntimeDatabase, readonly clock: ReplayClock) {}

  register<T extends object>(name: string, factory: () => T,
    mutators: readonly (keyof T & string)[]): T {
    if (this.restored || !name || this.entries.has(name) || !mutators.length) {
      throw new Error("INVALID_JOURNALED_STORE");
    }
    const entry: Entry = { name, factory, inner: factory(),
      mutators: new Set(mutators) };
    for (const method of mutators) {
      if (typeof (entry.inner as Record<string, unknown>)[method] !== "function") {
        throw new Error(`UNKNOWN_STORE_MUTATOR:${name}.${method}`);
      }
    }
    this.entries.set(name, entry);
    return new Proxy({} as T, { get: (_target, property) => {
      const member = (entry.inner as Record<PropertyKey, unknown>)[property];
      if (typeof member !== "function") return member;
      if (!entry.mutators.has(String(property))) return member.bind(entry.inner);
      return (...args: unknown[]) => {
        if (!this.restored || !this.healthy) throw new Error("DURABLE_KERNEL_NOT_READY");
        const occurredAt = this.clock.now();
        const current = (entry.inner as Record<PropertyKey, unknown>)[property] as
          (...args: unknown[]) => unknown;
        const result = this.clock.runAt(occurredAt, () => current.apply(entry.inner, args));
        if (result instanceof Promise) {
          return result.then(value => { this.persist(entry.name, String(property), args, value,
            occurredAt);
            return value; });
        }
        this.persist(entry.name, String(property), args, result, occurredAt);
        return result;
      };
    } });
  }

  async restore(): Promise<void> {
    this.restored = false;
    this.healthy = false;
    this.hashes.clear();
    for (const entry of this.entries.values()) entry.inner = entry.factory();
    try {
      for (const command of this.database.commands()) {
        const entry = this.entries.get(command.storeName);
        if (!entry || !entry.mutators.has(command.methodName)) {
          throw new Error(`UNKNOWN_STORE_COMMAND:${command.storeName}.${command.methodName}`);
        }
        this.clock.at(command.occurredAt);
        const method = (entry.inner as Record<string, (...args: unknown[]) => unknown>)[
          command.methodName]!;
        const result = await method.apply(entry.inner, command.args);
        if (digest(result) !== command.resultDigest) {
          throw new Error(`PROJECTION_REPLAY_MISMATCH:${command.sequence}:` +
            `${command.storeName}.${command.methodName}`);
        }
        const previous = this.hashes.get(entry.name)?.digest ?? "GENESIS";
        this.hashes.set(entry.name, { sequence: command.sequence,
          digest: chain(previous, command.sequence, command.resultDigest) });
      }
      const persisted = this.database.projectionDigests();
      if (persisted.size !== this.hashes.size || [...this.hashes].some(([name, value]) => {
        const saved = persisted.get(name);
        return saved?.sequence !== value.sequence || saved.digest !== value.digest;
      })) throw new Error("PROJECTION_DIGEST_MISMATCH");
      this.restored = true;
      this.healthy = true;
    } finally {
      this.clock.at(null);
    }
  }

  transaction<T>(work: () => T): T {
    if (!this.restored || !this.healthy) throw new Error("DURABLE_KERNEL_NOT_READY");
    const before = this.mutationCount;
    try { return this.database.transaction(work); }
    catch (error) {
      if (this.mutationCount !== before) this.healthy = false;
      throw error;
    }
  }

  isHealthy(): boolean { return this.restored && this.healthy; }

  private persist(name: string, method: string, args: unknown[], result: unknown,
    occurredAt: number): void {
    try {
      this.database.transaction(() => {
        const sequence = this.database.appendCommand(name, method, args, result, occurredAt);
        const previous = this.hashes.get(name)?.digest ?? "GENESIS";
        const next = chain(previous, sequence, digest(result));
        this.database.setProjectionDigest(name, sequence, next);
        this.hashes.set(name, { sequence, digest: next });
      });
      this.mutationCount++;
    } catch (error) {
      this.healthy = false;
      throw error;
    }
  }
}
