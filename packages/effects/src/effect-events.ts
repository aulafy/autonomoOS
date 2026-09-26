import type { EffectStatus } from "./effect-status.js";

export type EffectEventType = "effect.created" | "effect.prepared" |
  "effect.dispatch_started" | "effect.dispatch_reported" |
  "effect.committed" | "effect.failed" | "effect.unknown";
export interface EffectEvent {
  type: EffectEventType;
  effectId: string;
  taskId: string;
  fromStatus?: EffectStatus;
  toStatus: EffectStatus;
  effectVersion: number;
  at: number;
  details: Record<string, unknown>;
}
export interface EffectEventSink {
  append(event: EffectEvent): void;
}
export class InMemoryEffectEventSink implements EffectEventSink {
  private readonly events: EffectEvent[] = [];
  append(event: EffectEvent): void { this.events.push(structuredClone(event)); }
  list(): readonly EffectEvent[] { return this.events.map(event => structuredClone(event)); }
}
