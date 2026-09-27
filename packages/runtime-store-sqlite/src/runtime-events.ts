import type { RuntimeDatabase } from "./database.js";

export interface DurableRuntimeEvent {
  id: string;
  timestamp: number;
  [key: string]: unknown;
}

/** SQLite is authoritative; live delivery is scheduled only after commit. */
export class DurableRuntimeEventPublisher<T extends DurableRuntimeEvent> {
  constructor(private readonly database: RuntimeDatabase,
    private readonly publish: (event: T) => void) {}

  append(event: T): number {
    const sequence = this.database.appendRuntimeEvent(event);
    this.database.afterCommit(() => this.publish(event));
    return sequence;
  }
}
