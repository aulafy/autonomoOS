import assert from "node:assert/strict";
import test from "node:test";
import { DataObjectCompiler, joinDataLabels } from "../src/index.js";
import { fixture, fileId, label } from "./helpers.js";

test("label join preserves strongest confidentiality, categories and nonreleasable", () => {
  const joined = joinDataLabels([
    label("public", ["generic"]), label("secret", ["credential"], false)
  ]);
  assert.equal(joined.confidentiality, "secret");
  assert.deepEqual(joined.categories, ["generic", "credential"]);
  assert.equal(joined.releasable, false);
  assert.throws(() => joinDataLabels([]), /MISSING_DATA_LABEL/);
});

test("summarize, translate, paraphrase, format and LLM output retain source label", () => {
  const f = fixture();
  f.add("secret-1", label("secret", ["credential"]));
  for (const operation of ["summarize", "translate", "paraphrase", "format", "llm_output"] as const) {
    const derived = f.objects.derive({ id: operation, taskId: "task-1", createdAt: 100,
      metadata: {} }, ["secret-1"], operation);
    assert.equal(derived.label?.confidentiality, "secret");
    assert.deepEqual(derived.label?.categories, ["credential"]);
    assert.equal(f.objects.lineageFor(derived.id)[0].sourceObjectId, "secret-1");
    f.workingSets.add("task-1", derived.id, f.workingSets.get("task-1").version);
    assert.equal(f.engine.evaluate(f.request([derived.id])).verdict, "deny");
  }
});

test("derived data cannot cite another task or unknown source", () => {
  const f = fixture();
  f.add("source-1", label("secret"), "task-1");
  assert.throws(() => f.objects.derive({ id: "bad", taskId: "task-2", createdAt: 100,
    metadata: {} }, ["source-1"], "summarize"), /UNKNOWN_LINEAGE_SOURCE/);
  assert.throws(() => f.objects.derive({ id: "bad", taskId: "task-1", createdAt: 100,
    metadata: {} }, ["missing"], "summarize"), /UNKNOWN_LINEAGE_SOURCE/);
});

test("working set versions advance per task and defensive copies hold", () => {
  const f = fixture();
  f.add("a", label("public"));
  assert.equal(f.workingSets.get("task-1").version, 1);
  assert.equal(f.workingSets.get("task-2").version, 0);
  assert.throws(() => f.workingSets.add("task-1", "a", 0), /WORKING_SET_VERSION_CONFLICT/);
  f.workingSets.get("task-1").objectIds.length = 0;
  f.objects.get("a")!.label!.categories.push("financial");
  assert.deepEqual(f.workingSets.get("task-1").objectIds, ["a"]);
  assert.deepEqual(f.objects.get("a")?.label?.categories, []);
});

test("resource label compiles from host registry and missing label stays unknown", () => {
  const f = fixture();
  const compiler = new DataObjectCompiler(f.resources, f.objects);
  assert.equal(compiler.fromResource("unknown-source", "task-1", fileId, 100, true).label,
    null);
  const record = f.resources.get(fileId)!;
  f.resources.update({ ...record, dataLabel: { sensitivity: "secret",
    categories: ["credential"], source: "host", classifiedAt: 100 } }, 1);
  const compiled = compiler.fromResource("secret-source", "task-1", fileId, 100, false);
  assert.equal(compiled.label?.confidentiality, "secret");
  assert.deepEqual(compiled.label?.categories, ["credential"]);
  assert.equal(compiled.label?.releasable, false);
});
