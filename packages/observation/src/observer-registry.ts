import type { Observer } from "./observer.js";

export interface ObserverRegistry {
  register(observer: Observer): void;
  get(id: string): Observer | null;
}
