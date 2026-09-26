import type { BudgetVector } from "./budget-vector.js";

export type BudgetStatus = "active" | "frozen" | "closed";
export interface BudgetAccount {
  id: string;
  ownerPrincipalId: string;
  taskId?: string;
  ceiling: BudgetVector;
  reserved: BudgetVector;
  consumed: BudgetVector;
  status: BudgetStatus;
  createdAt: number;
  expiresAt?: number;
  version: number;
  metadata: Record<string, unknown>;
  parentBudgetId?: string;
  parentReservationId?: string;
}
export interface CreateBudgetInput {
  id: string;
  ownerPrincipalId: string;
  taskId?: string;
  ceiling: BudgetVector;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}
export interface CreateChildBudgetInput extends CreateBudgetInput {
  parentBudgetId: string;
  allocationReservationId: string;
}
