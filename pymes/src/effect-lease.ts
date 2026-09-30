export interface EffectLease {
  effectId: string;
  ownerId: string;
  expiresAt: number;
}

export interface EffectLeaseStore {
  acquire(effectId: string, ownerId: string, now?: number): EffectLease | null;
  release(effectId: string, ownerId: string): boolean;
  clearExpired(now?: number): number;
}

/**
 * Process-local lease primitive used by workers before a durable API lease is
 * available. It is deliberately tenant agnostic: callers must namespace the
 * effect id or provide a store per tenant.
 */
export class InMemoryEffectLeaseStore implements EffectLeaseStore {
  private readonly leases = new Map<string, EffectLease>();

  constructor(private readonly ttlMs = 60_000) {
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 300_000) throw new Error("INVALID_EFFECT_LEASE_TTL");
  }

  acquire(effectId: string, ownerId: string, now = Date.now()): EffectLease | null {
    if (!validLeaseId(effectId) || !validLeaseId(ownerId)) throw new Error("INVALID_EFFECT_LEASE_ID");
    const current = this.leases.get(effectId);
    if (current && current.expiresAt > now && current.ownerId !== ownerId) return null;
    const lease = { effectId, ownerId, expiresAt: now + this.ttlMs };
    this.leases.set(effectId, lease);
    return { ...lease };
  }

  release(effectId: string, ownerId: string): boolean {
    const current = this.leases.get(effectId);
    if (!current || current.ownerId !== ownerId) return false;
    this.leases.delete(effectId);
    return true;
  }

  clearExpired(now = Date.now()): number {
    let removed = 0;
    for (const [effectId, lease] of this.leases) {
      if (lease.expiresAt <= now) { this.leases.delete(effectId); removed += 1; }
    }
    return removed;
  }
}

export class SqliteEffectLeaseStore implements EffectLeaseStore {
  constructor(private readonly db: DatabaseSync, private readonly ttlMs = 60_000, private readonly namespace = "default") {
    if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > 300_000) throw new Error("INVALID_EFFECT_LEASE_TTL");
    if (!validLeaseId(namespace)) throw new Error("INVALID_EFFECT_LEASE_NAMESPACE");
    this.db.exec("CREATE TABLE IF NOT EXISTS effect_leases (effect_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, expires_at INTEGER NOT NULL)");
  }

  acquire(effectId: string, ownerId: string, now = Date.now()): EffectLease | null {
    if (!validLeaseId(effectId) || !validLeaseId(ownerId)) throw new Error("INVALID_EFFECT_LEASE_ID");
    const key = `${this.namespace}:${effectId}`;
    const result = this.db.prepare(`
      INSERT INTO effect_leases (effect_id, owner_id, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(effect_id) DO UPDATE SET owner_id = excluded.owner_id, expires_at = excluded.expires_at
      WHERE effect_leases.expires_at <= ? OR effect_leases.owner_id = excluded.owner_id
    `).run(key, ownerId, now + this.ttlMs, now);
    if (Number(result.changes) !== 1) return null;
    return { effectId, ownerId, expiresAt: now + this.ttlMs };
  }

  release(effectId: string, ownerId: string): boolean {
    if (!validLeaseId(effectId) || !validLeaseId(ownerId)) throw new Error("INVALID_EFFECT_LEASE_ID");
    return Number(this.db.prepare("DELETE FROM effect_leases WHERE effect_id = ? AND owner_id = ?").run(`${this.namespace}:${effectId}`, ownerId).changes) === 1;
  }

  clearExpired(now = Date.now()): number {
    return Number(this.db.prepare("DELETE FROM effect_leases WHERE expires_at <= ?").run(now).changes);
  }
}

function validLeaseId(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}
import type { DatabaseSync } from "node:sqlite";
