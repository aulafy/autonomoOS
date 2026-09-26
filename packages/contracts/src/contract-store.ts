import type { SessionContract } from "./contract.js";

export interface ContractStore {
  create(contract: SessionContract): Promise<void>;

  get(contractId: string): Promise<SessionContract | null>;

  getForTask(taskId: string): Promise<SessionContract | null>;

  list(): Promise<SessionContract[]>;

  markStatus(
    contractId: string,
    status: SessionContract["status"]
  ): Promise<void>;
}
