import type { QuoteOffer } from "./quote-offers.js";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WorkspaceStore {
  loadReviewIds(fallback: readonly string[]): Set<string>;
  saveReviewIds(ids: ReadonlySet<string>): void;
  loadOffers(): Map<string, QuoteOffer[]>;
  saveOffers(offers: ReadonlyMap<string, readonly QuoteOffer[]>): void;
  clear(): void;
}

const VERSION = "v1";

function browserStorage(): StorageLike | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

function decode<T>(storage: StorageLike | null, key: string, fallback: T): T {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function createWorkspaceStore(storage: StorageLike | null = browserStorage(),
  namespace = "pymes-workspace"): WorkspaceStore {
  const key = (name: string) => `${namespace}:${VERSION}:${name}`;
  return {
    loadReviewIds(fallback) {
      const value = decode<unknown>(storage, key("review"), [...fallback]);
      return new Set(Array.isArray(value) ? value.filter(item => typeof item === "string") : fallback);
    },
    saveReviewIds(ids) {
      storage?.setItem(key("review"), JSON.stringify([...ids]));
    },
    loadOffers() {
      const value = decode<unknown>(storage, key("offers"), {});
      const result = new Map<string, QuoteOffer[]>();
      if (!value || typeof value !== "object" || Array.isArray(value)) return result;
      for (const [caseId, offers] of Object.entries(value)) {
        if (Array.isArray(offers)) result.set(caseId, offers as QuoteOffer[]);
      }
      return result;
    },
    saveOffers(offers) {
      storage?.setItem(key("offers"), JSON.stringify(Object.fromEntries(offers)));
    },
    clear() {
      storage?.removeItem(key("review"));
      storage?.removeItem(key("offers"));
    }
  };
}
