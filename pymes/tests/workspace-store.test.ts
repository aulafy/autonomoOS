import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceStore, type StorageLike } from "../src/workspace-store.js";

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
}

test("workspace store persists review ids and offers with a versioned namespace", () => {
  const storage = memoryStorage();
  const first = createWorkspaceStore(storage, "test-agency");
  first.saveReviewIds(new Set(["msg-1", "msg-2"]));
  first.saveOffers(new Map([["msg-2", [{
    id: "offer-1", caseId: "msg-2", line: "home", insurer: "Test",
    insurerReference: "R-1", sourceDocument: "doc", annualPremiumCents: 10000,
    validUntil: "2026-10-01", coverageSummary: "c", exclusionsSummary: "e",
    enteredAt: "2026-09-29T10:00:00Z", source: "operator_transcription"
  }]]]));
  const second = createWorkspaceStore(storage, "test-agency");
  assert.deepEqual([...second.loadReviewIds([])], ["msg-1", "msg-2"]);
  assert.equal(second.loadOffers().get("msg-2")?.[0]?.insurerReference, "R-1");
});

test("corrupt stored data fails closed to empty state", () => {
  const storage = memoryStorage();
  storage.setItem("test:v1:review", "not-json");
  storage.setItem("test:v1:offers", JSON.stringify(["not-an-object"]));
  const store = createWorkspaceStore(storage, "test");
  assert.deepEqual([...store.loadReviewIds(["fallback"])], ["fallback"]);
  assert.equal(store.loadOffers().size, 0);
});

test("clear removes only this workspace namespace", () => {
  const storage = memoryStorage();
  const store = createWorkspaceStore(storage, "test");
  store.saveReviewIds(new Set(["msg-1"]));
  store.clear();
  assert.deepEqual([...store.loadReviewIds([])], []);
});
