import assert from "node:assert/strict";
import test from "node:test";
import { hashSessionToken } from "../src/auth.js";

test("session token hash is deterministic and fixed length", () => {
  const token = "owner-session-token-123456";
  const hash = hashSessionToken(token);
  assert.equal(hash, hashSessionToken(token));
  assert.equal(hash.length, 64);
  assert.notEqual(hash, token);
  assert.notEqual(hash, hashSessionToken(`${token}-different`));
});
