import {
  SessionContractSchema,
  cloneContract,
  type SessionContract
} from "./contract.js";
import type { ContractStore } from "./contract-store.js";

export class InMemoryContractStore implements ContractStore {
  private readonly values = new Map<string, SessionContract>();

  async create(contract: SessionContract): Promise<void> {
    const parsed = SessionContractSchema.parse(contract);

    if (this.values.has(parsed.id)) {
      throw new Error(`Contract '${parsed.id}' already exists.`);
    }

    const activeForTask = Array.from(this.values.values()).find(
      current => current.taskId === parsed.taskId && current.status === "active"
    );

    if (activeForTask) {
      throw new Error(
        `Task '${parsed.taskId}' already has active contract '${activeForTask.id}'.`
      );
    }

    this.values.set(parsed.id, cloneContract(parsed));
  }

  async get(contractId: string): Promise<SessionContract | null> {
    const value = this.values.get(contractId);
    return value ? cloneContract(value) : null;
  }

  async getForTask(taskId: string): Promise<SessionContract | null> {
    const value = Array.from(this.values.values()).find(
      candidate => candidate.taskId === taskId && candidate.status === "active"
    );

    return value ? cloneContract(value) : null;
  }

  async list(): Promise<SessionContract[]> {
    return Array.from(this.values.values()).map(value => cloneContract(value));
  }

  async markStatus(
    contractId: string,
    status: SessionContract["status"]
  ): Promise<void> {
    const current = this.values.get(contractId);

    if (!current) {
      throw new Error(`Unknown contract '${contractId}'.`);
    }

    if (current.status !== "active" && current.status !== status) {
      throw new Error(
        `Terminal contract '${contractId}' cannot transition from '${current.status}' to '${status}'.`
      );
    }

    this.values.set(
      contractId,
      cloneContract({
        ...current,
        status
      })
    );
  }
}
