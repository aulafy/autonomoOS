import { SupervisorError, type EmergencyStopState, type QuarantineEntry } from "./types.js";

export class InMemoryEmergencyStopStore {
  private state: EmergencyStopState = { active: false };
  get(): EmergencyStopState { return structuredClone(this.state); }
  activate(reason: string, at: number): EmergencyStopState {
    if (!reason || !Number.isFinite(at)) throw new SupervisorError("INVALID_EMERGENCY_STOP");
    if (!this.state.active) this.state = { active: true, reason, activatedAt: at };
    return this.get();
  }
  /** Only an explicit host operator can call this; tick() never clears it. */
  clearByOperator(): EmergencyStopState { this.state = { active: false }; return this.get(); }
}

export class InMemoryQuarantineStore {
  private readonly entries = new Map<string, QuarantineEntry>();
  add(entry: QuarantineEntry): QuarantineEntry {
    if (!entry?.id || !entry.executorId || !entry.reason || !Number.isFinite(entry.createdAt)) {
      throw new SupervisorError("INVALID_QUARANTINE");
    }
    if (this.entries.has(entry.id)) throw new SupervisorError("QUARANTINE_EXISTS");
    const stored = structuredClone(entry);
    this.entries.set(stored.id, stored);
    return structuredClone(stored);
  }
  list(): QuarantineEntry[] { return [...this.entries.values()].map(entry => structuredClone(entry)); }
  isQuarantined(executorId: string): boolean {
    return [...this.entries.values()].some(entry => entry.executorId === executorId && entry.active);
  }
}
