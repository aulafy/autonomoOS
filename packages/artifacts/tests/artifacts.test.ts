import test from "node:test";
import assert from "node:assert/strict";
import { ArtifactRegistry,type ArtifactRecord } from "../src/index.js";
const artifact=(): ArtifactRecord => ({ id:"artifact1",taskId:"task",kind:"test-report",uri:"resource:file:report",digest:`sha256:${"a".repeat(64)}`,mediaType:"application/json",createdBy:{ id:"host",kind:"host" },createdAt:100,provenance:[{ sourceRef:"command:1",operation:"observed",actor:{ id:"host",kind:"host" },createdAt:100,sourceDigest:`sha256:${"b".repeat(64)}` }] });
test("artifact digest and provenance are immutable, detached and preserved",() => {
  const registry=new ArtifactRegistry(),record=artifact(),receipt=registry.append(record); assert.deepEqual(registry.append(record),receipt);
  assert.deepEqual(registry.get(record.id),record); record.provenance[0]!.sourceRef="changed"; assert.equal(registry.get(record.id)!.provenance[0]!.sourceRef,"command:1");
  assert.throws(() => registry.append({ ...artifact(),digest:`sha256:${"c".repeat(64)}` }),/ID_CONFLICT/);
  assert.equal(registry.list("foreign").length,0);
});
test("unverified artifacts may omit digest but cannot imply verified content",() => {
  const registry=new ArtifactRegistry(),record=artifact(); delete record.digest; registry.append(record); assert.equal(registry.get(record.id)!.digest,undefined);
});
test("URI credentials, secret metadata and invalid digest are rejected",() => {
  for (const patch of [{ uri:"https://user:password@example.com/report" },{ digest:"sha256:not-a-digest" },{ metadata:{ token:"secret" } },{ uri:"javascript:alert(1)" }]) assert.throws(() => new ArtifactRegistry().append({ ...artifact(),...patch }));
});
