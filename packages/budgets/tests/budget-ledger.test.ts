import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryBudgetLedger, assertBudgetInvariant, type BudgetAccount, type BudgetVector, type Clock
} from "../src/index.js";

const ceiling = { "money:EUR:minor": "1000", api_calls: "5", gpu_ms: "2000" };
function fixture() {
  let now = 100;
  const clock: Clock = { now: () => now };
  const ledger = new InMemoryBudgetLedger(clock);
  const create = (overrides: Partial<Parameters<typeof ledger.createBudget>[0]> = {}) =>
    ledger.createBudget({ id: "budget-1", ownerPrincipalId: "astra", taskId: "task-1",
      ceiling, ...overrides });
  const reserve = (id: string, amount: BudgetVector, expectedVersion?: number) =>
    ledger.reserve({ id, budgetId: "budget-1", principalId: "astra", taskId: "task-1",
      amount }, expectedVersion ?? ledger.getBudget("budget-1")!.version);
  const assertState = (expected: {
    available: BudgetVector; reserved: BudgetVector; consumed: BudgetVector
  }) => {
    const account = ledger.getBudget("budget-1")!;
    assertBudgetInvariant(account);
    assert.deepEqual({ ...ledger.availableBudget(account.id) }, expected.available);
    assert.deepEqual({ ...account.reserved }, expected.reserved);
    assert.deepEqual({ ...account.consumed }, expected.consumed);
  };
  return { ledger, create, reserve, assertState, setNow: (value: number) => { now = value; } };
}

test("create budget starts fully available and has no authorization API", () => {
  const f = fixture();
  const account = f.create();
  assert.equal(account.status, "active");
  f.assertState({ available: ceiling,
    reserved: { "money:EUR:minor": "0", api_calls: "0", gpu_ms: "0" },
    consumed: { "money:EUR:minor": "0", api_calls: "0", gpu_ms: "0" } });
  assert.equal("authorize" in f.ledger, false);
  assert.equal("grant" in f.ledger, false);
});

test("reserve changes reserved and available, preserving every dimension", () => {
  const f = fixture();
  f.create();
  f.reserve("r1", { "money:EUR:minor": "500", api_calls: "2" });
  f.assertState({ available: { "money:EUR:minor": "500", api_calls: "3", gpu_ms: "2000" },
    reserved: { "money:EUR:minor": "500", api_calls: "2", gpu_ms: "0" },
    consumed: { "money:EUR:minor": "0", api_calls: "0", gpu_ms: "0" } });
  f.reserve("r2", { "money:EUR:minor": "300", api_calls: "1" });
  f.assertState({ available: { "money:EUR:minor": "200", api_calls: "2", gpu_ms: "2000" },
    reserved: { "money:EUR:minor": "800", api_calls: "3", gpu_ms: "0" },
    consumed: { "money:EUR:minor": "0", api_calls: "0", gpu_ms: "0" } });
});

test("multidimensional overflow rejects entire reservation", () => {
  const f = fixture();
  f.create();
  assert.throws(() => f.reserve("r1", { "money:EUR:minor": "500", api_calls: "6" }),
    /INSUFFICIENT_BUDGET/);
  assert.equal(f.ledger.getReservation("r1"), null);
  f.assertState({ available: ceiling,
    reserved: { "money:EUR:minor": "0", api_calls: "0", gpu_ms: "0" },
    consumed: { "money:EUR:minor": "0", api_calls: "0", gpu_ms: "0" } });
  assert.throws(() => f.reserve("r2", { "money:USD:minor": "1" }),
    /UNKNOWN_BUDGET_DIMENSION/);
});

test("commit uses actual amount and returns unused capacity", () => {
  const f = fixture();
  f.create();
  f.reserve("r1", { "money:EUR:minor": "1000", api_calls: "2" });
  f.ledger.commitReservation("r1", { principalId: "astra", taskId: "task-1" },
    { "money:EUR:minor": "750", api_calls: "1" }, 1);
  f.assertState({ available: { "money:EUR:minor": "250", api_calls: "4", gpu_ms: "2000" },
    reserved: { "money:EUR:minor": "0", api_calls: "0", gpu_ms: "0" },
    consumed: { "money:EUR:minor": "750", api_calls: "1", gpu_ms: "0" } });
});

test("actual above reservation rejects without top-up or state change", () => {
  const f = fixture();
  f.create();
  f.reserve("r1", { "money:EUR:minor": "500" });
  assert.throws(() => f.ledger.commitReservation("r1", {
    principalId: "astra", taskId: "task-1"
  }, { "money:EUR:minor": "501" }, 1), /ACTUAL_EXCEEDS_RESERVATION/);
  const account = f.ledger.getBudget("budget-1")!;
  assertBudgetInvariant(account);
  assert.equal(account.reserved["money:EUR:minor"], "500");
  assert.equal(account.consumed["money:EUR:minor"], "0");
});

test("freeze blocks new reservations but existing ones can settle", () => {
  const f = fixture();
  f.create();
  f.reserve("r1", { api_calls: "2" });
  f.ledger.freezeBudget("budget-1", 2);
  assert.throws(() => f.reserve("r2", { api_calls: "1" }), /BUDGET_FROZEN/);
  f.ledger.commitReservation("r1", { principalId: "astra", taskId: "task-1" },
    { api_calls: "1" }, 1);
  assertBudgetInvariant(f.ledger.getBudget("budget-1")!);
  assert.equal(f.ledger.getBudget("budget-1")?.consumed.api_calls, "1");
  f.ledger.unfreezeBudget("budget-1", 4);
  assert.equal(f.ledger.getBudget("budget-1")?.status, "active");
});

test("budget expiry and close with active reservations fail at boundary", () => {
  const f = fixture();
  f.create({ expiresAt: 150 });
  f.reserve("r1", { api_calls: "1" });
  assert.throws(() => f.ledger.closeBudget("budget-1", 2), /BUDGET_HAS_ACTIVE_RESERVATIONS/);
  f.setNow(150);
  assert.throws(() => f.reserve("r2", { api_calls: "1" }), /BUDGET_EXPIRED/);
  f.ledger.releaseReservation("r1", { principalId: "astra", taskId: "task-1" }, 1);
  assert.equal(f.ledger.closeBudget("budget-1", 3).status, "closed");
});

test("principal, task and optimistic version are bound", () => {
  const f = fixture();
  f.create();
  assert.throws(() => f.ledger.reserve({ id: "r1", budgetId: "budget-1",
    principalId: "other", taskId: "task-1", amount: { api_calls: "1" } }, 1),
  /PRINCIPAL_MISMATCH/);
  assert.throws(() => f.ledger.reserve({ id: "r1", budgetId: "budget-1",
    principalId: "astra", taskId: "other", amount: { api_calls: "1" } }, 1),
  /TASK_MISMATCH/);
  f.reserve("r1", { api_calls: "1" });
  assert.throws(() => f.reserve("r2", { api_calls: "1" }, 1), /VERSION_CONFLICT/);
  assert.throws(() => f.ledger.releaseReservation("r1", {
    principalId: "other", taskId: "task-1"
  }, 1), /PRINCIPAL_MISMATCH/);
  assert.throws(() => f.ledger.releaseReservation("r1", {
    principalId: "astra", taskId: "other"
  }, 1), /TASK_MISMATCH/);
});

test("reads and writes return defensive copies", () => {
  const f = fixture();
  const inputMetadata = { nested: { value: 1 } };
  const account = f.create({ metadata: inputMetadata });
  inputMetadata.nested.value = 2;
  (account.metadata.nested as { value: number }).value = 3;
  assert.deepEqual(f.ledger.getBudget("budget-1")?.metadata, { nested: { value: 1 } });
  const reservation = f.ledger.reserve({ id: "r1", budgetId: "budget-1",
    principalId: "astra", taskId: "task-1", amount: { api_calls: "1" },
    metadata: { nested: { value: 1 } } }, 1);
  (reservation.metadata.nested as { value: number }).value = 2;
  assert.deepEqual(f.ledger.getReservation("r1")?.metadata, { nested: { value: 1 } });
  assertBudgetInvariant(f.ledger.getBudget("budget-1")!);
});
