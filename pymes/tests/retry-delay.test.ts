import assert from "node:assert/strict";
import test from "node:test";
import { retryDelayMs } from "../src/retry-delay.js";

test("retry delay uses bounded seconds", () => {
  assert.equal(retryDelayMs("2"), 2000);
  assert.equal(retryDelayMs("0"), 1000);
  assert.equal(retryDelayMs("120"), 60000);
});

test("retry delay accepts a future HTTP date", () => {
  const future = new Date(Date.now() + 5000).toUTCString();
  assert.ok(retryDelayMs(future) >= 1000);
  assert.ok(retryDelayMs(future) <= 60000);
});

test("retry delay falls back for missing or invalid values", () => {
  assert.equal(retryDelayMs(undefined), 5000);
  assert.equal(retryDelayMs("invalid"), 5000);
});
