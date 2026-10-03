import test from "node:test";
import assert from "node:assert/strict";
import { CapabilityRegistry } from "../src/index.js";
test("capabilities are explicit, extensible and snapshots are detached", () => {
  const registry = new CapabilityRegistry(); assert.ok(registry.has("code.modify_repo"));
  registry.register({ id: "insurance.prepare_quote", description: "Prepare an insurance quote" });
  const snapshot = registry.snapshot(); snapshot[0]!.description = "changed";
  assert.notEqual(registry.snapshot()[0]!.description, "changed");
  assert.throws(() => registry.register({ id: "insurance.prepare_quote", description: "duplicate" }));
  assert.throws(() => registry.register({ id: "brand name", description: "invalid" }));
});
