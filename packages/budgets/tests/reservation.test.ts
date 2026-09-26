import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryBudgetLedger, assertBudgetInvariant, type Clock } from "../src/index.js";

function fixture() {
  let now = 100;
  const clock: Clock = { now: () => now };
  const ledger = new InMemoryBudgetLedger(clock);
  ledger.createBudget({ id: "budget", ownerPrincipalId: "astra", taskId: "task",
    ceiling: { api_calls: "10" } });
  const identity = { principalId: "astra", taskId: "task" };
  const reserve = (id: string, expiresAt?: number) => ledger.reserve({
    id, budgetId: "budget", ...identity, amount: { api_calls: "5" }, expiresAt
  }, ledger.getBudget("budget")!.version);
  const invariant = () => assertBudgetInvariant(ledger.getBudget("budget")!);
  return { ledger, identity, reserve, invariant, setNow: (value: number) => { now = value; } };
}

test("duplicate commit with same actual is idempotent; different actual rejects", () => {
  const f = fixture();
  f.reserve("r1");
  const first = f.ledger.commitReservation("r1", f.identity, { api_calls: "3" }, 1);
  f.invariant();
  const version = f.ledger.getBudget("budget")!.version;
  const second = f.ledger.commitReservation("r1", f.identity, { api_calls: "3" }, 1);
  assert.deepEqual(second, first);
  assert.equal(f.ledger.getBudget("budget")?.version, version);
  assert.throws(() => f.ledger.commitReservation("r1", f.identity, { api_calls: "4" }, 1),
    /RESERVATION_ALREADY_COMMITTED/);
  assert.throws(() => f.ledger.releaseReservation("r1", f.identity, 2),
    /RESERVATION_ALREADY_COMMITTED/);
  f.invariant();
});

test("release is idempotent and returns capacity", () => {
  const f = fixture();
  f.reserve("r1");
  f.invariant();
  const released = f.ledger.releaseReservation("r1", f.identity, 1);
  f.invariant();
  assert.equal(f.ledger.availableBudget("budget").api_calls, "10");
  assert.deepEqual(f.ledger.releaseReservation("r1", f.identity, 1), released);
  assert.equal(f.ledger.getBudget("budget")?.reserved.api_calls, "0");
});

test("expired reservation is rejected at exact boundary and released only explicitly", () => {
  const f = fixture();
  f.reserve("r1", 150);
  f.setNow(150);
  assert.throws(() => f.ledger.commitReservation("r1", f.identity,
    { api_calls: "3" }, 1), /RESERVATION_EXPIRED/);
  assert.equal(f.ledger.getBudget("budget")?.reserved.api_calls, "5");
  const expired = f.ledger.expireReservation("r1", 1);
  assert.equal(expired.status, "expired");
  f.invariant();
  assert.equal(f.ledger.availableBudget("budget").api_calls, "10");
});

test("reservation version conflict rejects stale settlement", () => {
  const f = fixture();
  f.reserve("r1");
  assert.throws(() => f.ledger.releaseReservation("r1", f.identity, 2),
    /VERSION_CONFLICT/);
  assert.equal(f.ledger.getReservation("r1")?.status, "active");
  f.invariant();
});
