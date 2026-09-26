import assert from "node:assert/strict";
import test from "node:test";
import { fixture, label, emailSink, publicSink, cloudModelSink, unknownSink } from "./helpers.js";

test("unknown object, unknown label and unknown sink fail closed", () => {
  const f = fixture();
  assert.equal(f.engine.evaluate(f.request(["missing"])).verdict, "deny");
  f.add("unknown", null);
  assert.equal(f.engine.evaluate(f.request(["unknown"])).ruleResults[0].reason,
    "UNKNOWN_DATA_LABEL");
  f.add("public", label("public"));
  assert.equal(f.engine.evaluate(f.request(["public"], unknownSink)).verdict, "deny");
  assert.equal(f.engine.evaluate(f.request(["public"],
    "sink-http:not-registered" as typeof emailSink)).verdict, "deny");
});

test("secret to public, restricted to external and credentials to external deny", () => {
  for (const [dataLabel, sink] of [
    [label("secret"), publicSink], [label("restricted"), emailSink],
    [label("public", ["credential"]), emailSink],
    [label("public", ["personal_data"]), publicSink],
    [label("internal", [], false), emailSink]
  ] as const) {
    const f = fixture();
    f.add("object-1", dataLabel);
    assert.equal(f.engine.evaluate(f.request(["object-1"], sink)).verdict, "deny");
  }
});

test("confidential external flow needs exact release approval; public flow is allowed", () => {
  const f = fixture();
  f.add("confidential", label("confidential"));
  f.add("public", label("public"));
  assert.equal(f.engine.evaluate(f.request(["public"])).verdict, "allow");
  assert.equal(f.engine.evaluate(f.request(["confidential"])).verdict,
    "require_release_approval");
  assert.equal(f.engine.evaluate(f.request(["confidential"], cloudModelSink)).verdict,
    "require_release_approval");
});

test("cross-task object is invisible and working-set change makes decision stale", () => {
  const f = fixture();
  f.add("object-1", label("public"), "task-1");
  const decision = f.engine.evaluate(f.request(["object-1"]));
  assert.equal(decision.verdict, "allow");
  assert.equal(f.engine.evaluate(f.request(["object-1"], emailSink, "task-2")).verdict,
    "deny");
  f.add("object-2", label("public"));
  assert.equal(f.engine.isCurrent(decision), false);
});
