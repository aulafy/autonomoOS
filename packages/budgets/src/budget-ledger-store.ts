import type { BudgetAccount, CreateBudgetInput, CreateChildBudgetInput } from "./budget-account.js";
import type { BudgetReservation, ReserveInput, SettlementIdentity } from "./budget-reservation.js";
import type { BudgetVector } from "./budget-vector.js";

// Host-side capacity accounting. This interface does not authorize actions.
export interface BudgetLedgerStore {
  createBudget(input: CreateBudgetInput): BudgetAccount;
  createChildBudget(input: CreateChildBudgetInput, expectedParentVersion: number): BudgetAccount;
  getBudget(id: string): BudgetAccount | null;
  availableBudget(id: string): BudgetVector;
  freezeBudget(id: string, expectedVersion: number): BudgetAccount;
  unfreezeBudget(id: string, expectedVersion: number): BudgetAccount;
  closeBudget(id: string, expectedVersion: number): BudgetAccount;
  reserve(input: ReserveInput, expectedBudgetVersion: number): BudgetReservation;
  getReservation(id: string): BudgetReservation | null;
  commitReservation(id: string, identity: SettlementIdentity, actual: BudgetVector,
    expectedReservationVersion: number): BudgetReservation;
  releaseReservation(id: string, identity: SettlementIdentity,
    expectedReservationVersion: number): BudgetReservation;
  expireReservation(id: string, expectedReservationVersion: number): BudgetReservation;
}
