import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryEffectLeaseStore } from "../src/effect-lease.js";

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
});
