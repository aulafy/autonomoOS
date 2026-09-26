import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryBudgetLedger, assertBudgetInvariant, type Clock } from "../src/index.js";

test("child ceiling reserves parent capacity and settles consumed amount on close", () => {
  const clock: Clock = { now: () => 100 };
  const ledger = new InMemoryBudgetLedger(clock);
  ledger.createBudget({ id: "parent", ownerPrincipalId: "owner", taskId: "root-task",
    ceiling: { api_calls: "100", "money:EUR:minor": "1000" } });
  const child = ledger.createChildBudget({ id: "child", parentBudgetId: "parent",
    allocationReservationId: "allocation", ownerPrincipalId: "astra", taskId: "child-task",
    ceiling: { api_calls: "40", "money:EUR:minor": "400" } }, 1);
  assert.equal(child.parentBudgetId, "parent");
  assert.equal(ledger.availableBudget("parent").api_calls, "60");
  assertBudgetInvariant(ledger.getBudget("parent")!);
  assertBudgetInvariant(ledger.getBudget("child")!);
  assert.throws(() => ledger.releaseReservation("allocation", {
    principalId: "owner", taskId: "root-task"
  }, 1), /CHILD_BUDGET_ACTIVE/);
  assert.throws(() => ledger.closeBudget("parent", 2), /BUDGET_HAS_ACTIVE_RESERVATIONS/);
  ledger.reserve({ id: "child-use", budgetId: "child", principalId: "astra",
    taskId: "child-task", amount: { api_calls: "30", "money:EUR:minor": "300" } }, 1);
  ledger.commitReservation("child-use", { principalId: "astra", taskId: "child-task" },
    { api_calls: "25", "money:EUR:minor": "250" }, 1);
  assertBudgetInvariant(ledger.getBudget("child")!);
  assert.equal(ledger.closeBudget("child", 3).status, "closed");
  assert.equal(ledger.getReservation("allocation")?.status, "committed");
  assert.equal(ledger.getBudget("parent")?.consumed.api_calls, "25");
  assert.equal(ledger.availableBudget("parent").api_calls, "75");
  assertBudgetInvariant(ledger.getBudget("parent")!);
});

test("child cannot outlive parent or allocate more than parent available", () => {
  const clock: Clock = { now: () => 100 };
  const ledger = new InMemoryBudgetLedger(clock);
  ledger.createBudget({ id: "parent", ownerPrincipalId: "owner", taskId: "task",
    ceiling: { api_calls: "10" }, expiresAt: 200 });
  const child = { id: "child", parentBudgetId: "parent", allocationReservationId: "allocation",
    ownerPrincipalId: "astra", taskId: "child-task", ceiling: { api_calls: "11" },
    expiresAt: 200 };
  assert.throws(() => ledger.createChildBudget(child, 1), /INSUFFICIENT_BUDGET/);
  assert.equal(ledger.getBudget("child"), null);
  assert.equal(ledger.getReservation("allocation"), null);
  assert.throws(() => ledger.createChildBudget({ ...child, ceiling: { api_calls: "5" },
    expiresAt: 201 }, 1), /INVALID_TIME_WINDOW/);
  assertBudgetInvariant(ledger.getBudget("parent")!);
});
