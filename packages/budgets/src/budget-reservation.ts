import type { BudgetVector } from "./budget-vector.js";

export type ReservationStatus = "active" | "committed" | "released" | "expired";
export interface BudgetReservation {
  id: string;
  budgetId: string;
  principalId: string;
  taskId: string;
  effectId?: string;
  amount: BudgetVector;
  actualAmount?: BudgetVector;
  status: ReservationStatus;
  createdAt: number;
  expiresAt?: number;
  committedAt?: number;
  releasedAt?: number;
  version: number;
  metadata: Record<string, unknown>;
}
export interface ReserveInput {
  id: string;
  budgetId: string;
  principalId: string;
  taskId: string;
  effectId?: string;
  amount: BudgetVector;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}
export interface SettlementIdentity {
  principalId: string;
  taskId: string;
}
