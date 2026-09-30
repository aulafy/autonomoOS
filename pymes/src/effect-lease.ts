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

function validLeaseId(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}
