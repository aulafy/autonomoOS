import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { InMemoryEffectLeaseStore, SqliteEffectLeaseStore } from "../src/effect-lease.js";

test("lease store excludes another owner until expiry", () => {
  const store = new InMemoryEffectLeaseStore(1_000);
  assert.equal(store.acquire("effect-1", "worker-a", 10)?.ownerId, "worker-a");
  assert.equal(store.acquire("effect-1", "worker-b", 500), null);
  assert.equal(store.acquire("effect-1", "worker-b", 1_010)?.ownerId, "worker-b");
});

test("lease store only allows its owner to release", () => {
  const store = new InMemoryEffectLeaseStore();
  store.acquire("effect-1", "worker-a", 10);
  assert.equal(store.release("effect-1", "worker-b"), false);
  assert.equal(store.release("effect-1", "worker-a"), true);
  assert.equal(store.release("effect-1", "worker-a"), false);
});

test("lease store clears expired entries and validates configuration", () => {
  const store = new InMemoryEffectLeaseStore(1_000);
  store.acquire("effect-1", "worker-a", 10);
  assert.equal(store.clearExpired(1_010), 1);
  assert.throws(() => new InMemoryEffectLeaseStore(100), /INVALID_EFFECT_LEASE_TTL/);
  assert.throws(() => store.acquire("", "worker-a"), /INVALID_EFFECT_LEASE_ID/);
  assert.throws(() => store.acquire("effect\n1", "worker-a"), /INVALID_EFFECT_LEASE_ID/);
  assert.throws(() => store.acquire("effect-1", "x".repeat(201)), /INVALID_EFFECT_LEASE_ID/);
});

test("sqlite lease store acquires atomically and survives a second handle", () => {
  const db = new DatabaseSync(":memory:");
  const first = new SqliteEffectLeaseStore(db, 1_000, "agency-a");
  const second = new SqliteEffectLeaseStore(db, 1_000, "agency-a");
  assert.equal(first.acquire("effect-1", "worker-a", 10)?.ownerId, "worker-a");
  assert.equal(second.acquire("effect-1", "worker-b", 20), null);
  assert.equal(second.acquire("effect-1", "worker-b", 1_010)?.ownerId, "worker-b");
  assert.equal(first.release("effect-1", "worker-a"), false);
  assert.equal(second.release("effect-1", "worker-b"), true);
  const otherTenant = new SqliteEffectLeaseStore(db, 1_000, "agency-b");
  assert.equal(otherTenant.acquire("effect-1", "worker-b", 20)?.ownerId, "worker-b");
  db.close();
});
