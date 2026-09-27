import type { BudgetAccount, CreateBudgetInput, CreateChildBudgetInput } from "./budget-account.js";
import type { BudgetReservation, ReserveInput, SettlementIdentity } from "./budget-reservation.js";
import {
  addVectors, assertKnownDimensions, fitsWithin, normalizeVector, subtractVectors,
  vectorsEqual, zeroVector, type BudgetVector
} from "./budget-vector.js";
import type { BudgetLedgerStore } from "./budget-ledger-store.js";
import type { Clock } from "./clock.js";
import { BudgetError } from "./errors.js";

export function assertBudgetInvariant(account: BudgetAccount): void {
  const ceiling = normalizeVector(account.ceiling);
  const reserved = normalizeVector(account.reserved);
  const consumed = normalizeVector(account.consumed);
  assertKnownDimensions(reserved, ceiling);
  assertKnownDimensions(consumed, ceiling);
  if (!fitsWithin(addVectors(reserved, consumed), ceiling)) {
    throw new BudgetError("INVARIANT_VIOLATION", account.id);
  }
}

// All check-and-write operations are synchronous within one process. A durable
// implementation must make the account and reservation update one transaction.
export class InMemoryBudgetLedger implements BudgetLedgerStore {
  private readonly budgets = new Map<string, BudgetAccount>();
  private readonly reservations = new Map<string, BudgetReservation>();
  constructor(private readonly clock: Clock) {}

  createBudget(input: CreateBudgetInput): BudgetAccount {
    const now = this.clock.now();
    if (!input.id || !input.ownerPrincipalId || input.taskId === "") {
      throw new BudgetError("INVALID_IDENTITY");
    }
    if (this.budgets.has(input.id)) throw new BudgetError("BUDGET_ALREADY_EXISTS", input.id);
    if (input.expiresAt !== undefined && (!Number.isFinite(input.expiresAt) || input.expiresAt <= now)) {
      throw new BudgetError("INVALID_TIME_WINDOW");
    }
    const ceiling = normalizeVector(input.ceiling);
    const account: BudgetAccount = {
      id: input.id, ownerPrincipalId: input.ownerPrincipalId, taskId: input.taskId,
      ceiling, reserved: zeroVector(Object.keys(ceiling)),
      consumed: zeroVector(Object.keys(ceiling)), status: "active",
      createdAt: now, expiresAt: input.expiresAt, version: 1,
      metadata: structuredClone(input.metadata ?? {})
    };
    assertBudgetInvariant(account);
    this.budgets.set(account.id, account);
    return structuredClone(account);
  }

  createChildBudget(input: CreateChildBudgetInput, expectedParentVersion: number): BudgetAccount {
    const parent = this.requireBudget(input.parentBudgetId);
    this.checkVersion(parent.version, expectedParentVersion);
    if (!input.id || !input.ownerPrincipalId || !input.taskId || !input.allocationReservationId) {
      throw new BudgetError("INVALID_IDENTITY");
    }
    if (this.budgets.has(input.id)) throw new BudgetError("BUDGET_ALREADY_EXISTS", input.id);
    if (this.reservations.has(input.allocationReservationId)) {
      throw new BudgetError("RESERVATION_ALREADY_EXISTS", input.allocationReservationId);
    }
    const now = this.clock.now();
    if (input.expiresAt !== undefined && (!Number.isFinite(input.expiresAt) || input.expiresAt <= now)) {
      throw new BudgetError("INVALID_TIME_WINDOW");
    }
    if (parent.expiresAt !== undefined &&
      (input.expiresAt === undefined || input.expiresAt > parent.expiresAt)) {
      throw new BudgetError("INVALID_TIME_WINDOW");
    }
    const ceiling = normalizeVector(input.ceiling);
    const metadata = structuredClone(input.metadata ?? {});
    const child: BudgetAccount = {
      id: input.id, ownerPrincipalId: input.ownerPrincipalId, taskId: input.taskId,
      ceiling, reserved: zeroVector(Object.keys(ceiling)),
      consumed: zeroVector(Object.keys(ceiling)), status: "active",
      createdAt: now, expiresAt: input.expiresAt, version: 1, metadata,
      parentBudgetId: parent.id, parentReservationId: input.allocationReservationId
    };
    assertBudgetInvariant(child);
    // Reserve the whole child ceiling in the parent before publishing the child.
    this.reserve({ id: input.allocationReservationId, budgetId: parent.id,
      principalId: parent.ownerPrincipalId, taskId: parent.taskId ?? input.taskId,
      amount: ceiling, metadata: { childBudgetId: input.id } }, expectedParentVersion);
    this.budgets.set(child.id, child);
    return structuredClone(child);
  }

  getBudget(id: string): BudgetAccount | null {
    const account = this.budgets.get(id);
    return account ? structuredClone(account) : null;
  }

  availableBudget(id: string): BudgetVector {
    const account = this.requireBudget(id);
    assertBudgetInvariant(account);
    return subtractVectors(subtractVectors(account.ceiling, account.reserved), account.consumed);
  }

  freezeBudget(id: string, expectedVersion: number): BudgetAccount {
    const account = this.requireBudget(id);
    this.checkVersion(account.version, expectedVersion);
    if (account.status === "closed") throw new BudgetError("BUDGET_CLOSED");
    if (account.status === "frozen") return structuredClone(account);
    return this.saveBudget({ ...account, status: "frozen", version: account.version + 1 });
  }

  unfreezeBudget(id: string, expectedVersion: number): BudgetAccount {
    const account = this.requireBudget(id);
    this.checkVersion(account.version, expectedVersion);
    if (account.status === "closed") throw new BudgetError("BUDGET_CLOSED");
    if (account.status === "active") return structuredClone(account);
    if (account.expiresAt !== undefined && this.clock.now() >= account.expiresAt) {
      throw new BudgetError("BUDGET_EXPIRED");
    }
    return this.saveBudget({ ...account, status: "active", version: account.version + 1 });
  }

  closeBudget(id: string, expectedVersion: number): BudgetAccount {
    const account = this.requireBudget(id);
    this.checkVersion(account.version, expectedVersion);
    if (account.status === "closed") return structuredClone(account);
    if ([...this.reservations.values()].some(reservation =>
      reservation.budgetId === id && reservation.status === "active")) {
      throw new BudgetError("BUDGET_HAS_ACTIVE_RESERVATIONS");
    }
    if (account.parentBudgetId && account.parentReservationId) {
      return this.closeChild(account);
    }
    return this.saveBudget({ ...account, status: "closed", version: account.version + 1 });
  }

  reserve(input: ReserveInput, expectedBudgetVersion: number): BudgetReservation {
    const account = this.requireBudget(input.budgetId);
    this.checkVersion(account.version, expectedBudgetVersion);
    if (!input.id || !input.principalId || !input.taskId) throw new BudgetError("INVALID_IDENTITY");
    if (this.reservations.has(input.id)) throw new BudgetError("RESERVATION_ALREADY_EXISTS", input.id);
    if (account.status === "frozen") throw new BudgetError("BUDGET_FROZEN");
    if (account.status === "closed") throw new BudgetError("BUDGET_CLOSED");
    const now = this.clock.now();
    if (account.expiresAt !== undefined && now >= account.expiresAt) {
      throw new BudgetError("BUDGET_EXPIRED");
    }
    if (account.ownerPrincipalId !== input.principalId) throw new BudgetError("PRINCIPAL_MISMATCH");
    if (account.taskId !== undefined && account.taskId !== input.taskId) {
      throw new BudgetError("TASK_MISMATCH");
    }
    if (input.expiresAt !== undefined && (!Number.isFinite(input.expiresAt) || input.expiresAt <= now)) {
      throw new BudgetError("INVALID_TIME_WINDOW");
    }
    const amount = normalizeVector(input.amount);
    assertKnownDimensions(amount, account.ceiling);
    if (!fitsWithin(amount, this.availableBudget(account.id))) {
      throw new BudgetError("INSUFFICIENT_BUDGET");
    }
    const next = { ...account, reserved: addVectors(account.reserved, amount),
      version: account.version + 1 };
    assertBudgetInvariant(next);
    const reservation: BudgetReservation = {
      id: input.id, budgetId: account.id, principalId: input.principalId,
      taskId: input.taskId, effectId: input.effectId, amount,
      status: "active", createdAt: now, expiresAt: input.expiresAt,
      version: 1, metadata: structuredClone(input.metadata ?? {})
    };
    this.budgets.set(account.id, next);
    this.reservations.set(reservation.id, reservation);
    return structuredClone(reservation);
  }

  getReservation(id: string): BudgetReservation | null {
    const reservation = this.reservations.get(id);
    return reservation ? structuredClone(reservation) : null;
  }

  listReservations(): readonly BudgetReservation[] {
    return [...this.reservations.values()].map(reservation => structuredClone(reservation));
  }

  commitReservation(id: string, identity: SettlementIdentity, actual: BudgetVector,
    expectedReservationVersion: number): BudgetReservation {
    return this.commitReservationCore(id, identity, actual, expectedReservationVersion, false);
  }

  commitHeldReservation(id: string, identity: SettlementIdentity, actual: BudgetVector,
    expectedReservationVersion: number): BudgetReservation {
    return this.commitReservationCore(id, identity, actual, expectedReservationVersion, true);
  }

  private commitReservationCore(id: string, identity: SettlementIdentity, actual: BudgetVector,
    expectedReservationVersion: number, allowExpired: boolean): BudgetReservation {
    const reservation = this.requireReservation(id);
    this.checkIdentity(reservation, identity);
    const normalizedActual = normalizeVector(actual);
    const account = this.requireBudget(reservation.budgetId);
    assertKnownDimensions(normalizedActual, account.ceiling);
    if (reservation.status === "committed") {
      if (vectorsEqual(normalizedActual, reservation.actualAmount ?? {})) return structuredClone(reservation);
      throw new BudgetError("RESERVATION_ALREADY_COMMITTED");
    }
    if (reservation.status !== "active") throw new BudgetError("RESERVATION_NOT_ACTIVE");
    this.assertNoActiveChildForReservation(id);
    this.checkVersion(reservation.version, expectedReservationVersion);
    const now = this.clock.now();
    if (!allowExpired && reservation.expiresAt !== undefined && now >= reservation.expiresAt) {
      throw new BudgetError("RESERVATION_EXPIRED");
    }
    if (!allowExpired && account.expiresAt !== undefined && now >= account.expiresAt) {
      throw new BudgetError("BUDGET_EXPIRED");
    }
    if (!fitsWithin(normalizedActual, reservation.amount)) {
      throw new BudgetError("ACTUAL_EXCEEDS_RESERVATION");
    }
    const nextAccount = { ...account,
      reserved: subtractVectors(account.reserved, reservation.amount),
      consumed: addVectors(account.consumed, normalizedActual),
      version: account.version + 1 };
    assertBudgetInvariant(nextAccount);
    const nextReservation: BudgetReservation = { ...reservation,
      actualAmount: normalizedActual, status: "committed", committedAt: now,
      version: reservation.version + 1 };
    this.budgets.set(account.id, nextAccount);
    this.reservations.set(id, nextReservation);
    return structuredClone(nextReservation);
  }

  releaseReservation(id: string, identity: SettlementIdentity,
    expectedReservationVersion: number): BudgetReservation {
    const reservation = this.requireReservation(id);
    this.checkIdentity(reservation, identity);
    if (reservation.status === "released") return structuredClone(reservation);
    if (reservation.status === "committed") throw new BudgetError("RESERVATION_ALREADY_COMMITTED");
    if (reservation.status !== "active") throw new BudgetError("RESERVATION_NOT_ACTIVE");
    this.assertNoActiveChildForReservation(id);
    this.checkVersion(reservation.version, expectedReservationVersion);
    return this.releaseActive(reservation, "released");
  }

  expireReservation(id: string, expectedReservationVersion: number): BudgetReservation {
    const reservation = this.requireReservation(id);
    if (reservation.status === "expired") return structuredClone(reservation);
    if (reservation.status !== "active") throw new BudgetError("RESERVATION_NOT_ACTIVE");
    this.assertNoActiveChildForReservation(id);
    this.checkVersion(reservation.version, expectedReservationVersion);
    if (reservation.expiresAt === undefined || this.clock.now() < reservation.expiresAt) {
      throw new BudgetError("RESERVATION_NOT_ACTIVE");
    }
    return this.releaseActive(reservation, "expired");
  }

  private releaseActive(reservation: BudgetReservation, status: "released" | "expired"): BudgetReservation {
    const account = this.requireBudget(reservation.budgetId);
    const nextAccount = { ...account,
      reserved: subtractVectors(account.reserved, reservation.amount),
      version: account.version + 1 };
    assertBudgetInvariant(nextAccount);
    const nextReservation: BudgetReservation = { ...reservation,
      status, releasedAt: this.clock.now(), version: reservation.version + 1 };
    this.budgets.set(account.id, nextAccount);
    this.reservations.set(reservation.id, nextReservation);
    return structuredClone(nextReservation);
  }

  private closeChild(child: BudgetAccount): BudgetAccount {
    const parent = this.requireBudget(child.parentBudgetId!);
    const allocation = this.requireReservation(child.parentReservationId!);
    if (allocation.status !== "active" || allocation.budgetId !== parent.id) {
      throw new BudgetError("INVARIANT_VIOLATION", child.id);
    }
    const nextParent: BudgetAccount = { ...parent,
      reserved: subtractVectors(parent.reserved, allocation.amount),
      consumed: addVectors(parent.consumed, child.consumed),
      version: parent.version + 1 };
    assertBudgetInvariant(nextParent);
    const nextAllocation: BudgetReservation = { ...allocation,
      actualAmount: structuredClone(child.consumed), status: "committed",
      committedAt: this.clock.now(), version: allocation.version + 1 };
    const nextChild: BudgetAccount = { ...child, status: "closed", version: child.version + 1 };
    this.budgets.set(parent.id, nextParent);
    this.reservations.set(allocation.id, nextAllocation);
    this.budgets.set(child.id, nextChild);
    return structuredClone(nextChild);
  }

  private assertNoActiveChildForReservation(id: string): void {
    if ([...this.budgets.values()].some(account =>
      account.parentReservationId === id && account.status !== "closed")) {
      throw new BudgetError("CHILD_BUDGET_ACTIVE");
    }
  }

  private requireBudget(id: string): BudgetAccount {
    const account = this.budgets.get(id);
    if (!account) throw new BudgetError("BUDGET_NOT_FOUND", id);
    return account;
  }
  private requireReservation(id: string): BudgetReservation {
    const reservation = this.reservations.get(id);
    if (!reservation) throw new BudgetError("RESERVATION_NOT_FOUND", id);
    return reservation;
  }
  private checkVersion(actual: number, expected: number): void {
    if (actual !== expected) throw new BudgetError("VERSION_CONFLICT");
  }
  private checkIdentity(reservation: BudgetReservation, identity: SettlementIdentity): void {
    if (reservation.principalId !== identity.principalId) throw new BudgetError("PRINCIPAL_MISMATCH");
    if (reservation.taskId !== identity.taskId) throw new BudgetError("TASK_MISMATCH");
  }
  private saveBudget(account: BudgetAccount): BudgetAccount {
    assertBudgetInvariant(account);
    this.budgets.set(account.id, account);
    return structuredClone(account);
  }
}
