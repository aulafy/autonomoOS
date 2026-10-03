import test from "node:test";
import assert from "node:assert/strict";
import { ContextEnvelopeStore } from "../src/index.js";
import { contextDigest } from "../src/canonical.js";
import { fixture } from "./helpers.js";
test("context includes required decisions and artifacts with exact labelled provenance", () => {
  const f=fixture(); const envelope=f.engine.build(f.request);
  assert.equal(envelope.decisions[0]!.id,"decision"); assert.equal(envelope.artifacts[0]!.id,"artifact");
  assert.equal(envelope.provenance.length,4); assert.ok(envelope.provenance.every(value => value.sourceDigest.length===64));
  assert.equal(envelope.flow.verdict,"allow"); assert.equal(f.engine.render(envelope).format,"orca-spec");
});
test("unrequested email history and explicitly requested unrelated scope are omitted", () => {
  const f=fixture(); f.add("email","fact","UNRELATED_EMAIL_CONTENT",{ category: "email_history" });
  f.add("foreign","fact","FOREIGN_TASK_CONTENT",{ taskId: "another-task" }); f.request.optionalRefs=["foreign"];
  const envelope=f.engine.build(f.request), rendered=f.engine.render(envelope);
  assert.equal(envelope.facts.length,0); assert.ok(envelope.excludedCategories.includes("email_history"));
  assert.ok(!rendered.content.includes("UNRELATED_EMAIL_CONTENT")); assert.ok(!rendered.content.includes("FOREIGN_TASK_CONTENT"));
});
test("forbidden policy category and restricted external data are explicitly excluded", () => {
  const f=fixture(); f.add("forbidden","fact","FORBIDDEN",{ category: "forbidden" });
  f.add("private","fact","RESTRICTED",{}, { confidentiality: "restricted" }); f.request.optionalRefs=["forbidden","private"];
  const envelope=f.engine.build(f.request); assert.equal(envelope.facts.length,0);
  assert.deepEqual(envelope.exclusions.map(value => value.reason),["policy_denied","information_flow_denied"]);
});
test("cloud actor never receives local-only source, local model can receive it", () => {
  const cloud=fixture(); cloud.add("private","fact","LOCAL_ONLY",{ locality: "local-only" }); cloud.request.optionalRefs=["private"];
  const envelope=cloud.engine.build(cloud.request); assert.ok(!cloud.engine.render(envelope).content.includes("LOCAL_ONLY"));
  const local=fixture(true); local.add("private","fact","LOCAL_ONLY",{ locality: "local-only" }); local.request.optionalRefs=["private"];
  assert.ok(local.engine.render(local.engine.build(local.request)).content.includes("LOCAL_ONLY"));
  assert.equal(local.engine.render(local.engine.build(local.request)).format,"local-model-json");
});
test("required source denied or missing fails rather than producing incomplete context", () => {
  const f=fixture(); f.request.requiredRefs.push("missing"); assert.throws(() => f.engine.build(f.request),/REQUIRED_CONTEXT_UNAVAILABLE/);
  f.request.requiredRefs=["decision","artifact"]; f.deny(); assert.throws(() => f.engine.build(f.request),/REQUIRED_CONTEXT_UNAVAILABLE/);
});
test("goal and objective obey the same policy as other content", () => {
  const f=fixture(); f.catalog.find(source => source.id==="goal")!.category="forbidden";
  assert.throws(() => f.engine.build(f.request),/REQUIRED_CONTEXT_UNAVAILABLE/);
});
test("context is deeply immutable and versions retain the prior envelope", () => {
  const f=fixture(), store=new ContextEnvelopeStore(), first=f.engine.build(f.request); store.record(first);
  assert.throws(() => { first.decisions[0]!.value="mutated"; },TypeError);
  const copy=store.get(first.id)!; copy.goal="changed"; assert.equal(store.get(first.id)!.goal,first.goal);
  const second=f.engine.build({ ...f.request,version: 2,previousEnvelopeId: first.id }); store.record(second);
  assert.deepEqual(store.record(second),{ envelopeId: second.id });
  assert.equal(store.get(first.id)!.version,1); assert.equal(store.get(second.id)!.version,2);
  assert.throws(() => store.record(f.engine.build({ ...f.request,version: 3,previousEnvelopeId: first.id })),/VERSION_CONFLICT/);
});
test("render rechecks policy and working set before provider handoff", () => {
  const f=fixture(), envelope=f.engine.build(f.request); f.deny(); assert.throws(() => f.engine.render(envelope));
  const g=fixture(), snapshot=g.engine.build(g.request); g.add("new","fact","New source");
  assert.throws(() => g.engine.render(snapshot),/STALE_CONTEXT_FLOW/);
});
test("rehashed forged fact partitions cannot bypass source or information-flow checks", () => {
  const f=fixture(), envelope=structuredClone(f.engine.build(f.request));
  envelope.facts.push({ ...envelope.sources[0]!,kind:"fact",value:"INJECTED_SECRET" });
  const { id:_id,...content }=envelope; envelope.id=`context:${contextDigest(content)}`;
  assert.throws(() => f.engine.render(envelope),/CONTEXT_SOURCE_OR_POLICY_CHANGED/);
});
test("raw credentials are excluded even for local agents", () => {
  const f=fixture(true); f.add("credential","fact","RAW_SECRET",{}, { categories: ["credential"] }); f.request.optionalRefs=["credential"];
  const envelope=f.engine.build(f.request); assert.equal(envelope.facts.length,0);
  assert.ok(!f.engine.render(envelope).content.includes("RAW_SECRET"));
});
test("content changes after context construction require a new envelope", () => {
  const f=fixture(), envelope=f.engine.build(f.request); f.catalog.find(source => source.id==="decision")!.value="Changed choice";
  assert.throws(() => f.engine.render(envelope),/CONTEXT_SOURCE_OR_POLICY_CHANGED/);
});
test("sink binding cannot be substituted by changing the selected actor", () => {
  const f=fixture(); f.request.actor.id="other:actor";
  assert.throws(() => f.engine.build(f.request),/CONTEXT_TARGET_MISMATCH/);
});
test("aggregate confidential context needs an exact unexpired release approval", () => {
  const f=fixture(); f.add("confidential","fact","CONFIDENTIAL",{}, { confidentiality:"confidential" }); f.request.requiredRefs.push("confidential");
  assert.throws(() => f.engine.build(f.request),/CONTEXT_RELEASE_NOT_AUTHORIZED/);
  const objectIds=f.catalog.map(source => source.objectId).sort();
  f.approvals.append({ id:"release",taskId:f.request.taskId,intentId:f.request.intentId,sinkId:f.request.sinkId,objectIds,workingSetVersion:f.workingSets.get("task").version,issuedAt:100,expiresAt:150,issuerId:"host" });
  f.request.approvalId="release"; const envelope=f.engine.build(f.request);
  assert.ok(f.engine.render(envelope).content.includes("CONFIDENTIAL"));
  f.setNow(150); assert.throws(() => f.engine.render(envelope),/CONTEXT_RELEASE_NOT_AUTHORIZED/);
});
test("permission references expire before handoff and cannot contain raw secret fields", () => {
  const f=fixture(true); f.add("permission","permission",{ id:"grant",resourceRef:"file:fixture",actions:["file.read"],authorizationRef:"host:grant",expiresAt:150 }); f.request.requiredRefs.push("permission");
  const envelope=f.engine.build(f.request); f.setNow(150); assert.throws(() => f.engine.render(envelope),/CONTEXT_PERMISSION_EXPIRED/);
  const g=fixture(true); g.add("permission","permission",{ id:"grant",resourceRef:"file:fixture",actions:["file.read"],authorizationRef:"host:grant",expiresAt:150,password:"secret" }); g.request.requiredRefs.push("permission");
  assert.throws(() => g.engine.build(g.request),/INVALID_CONTEXT_INPUT/);
});
test("render tolerates a later clock while preserving the context's recorded evaluation time", () => {
  const f=fixture(),envelope=f.engine.build(f.request); f.setNow(120);
  assert.equal(f.engine.render(envelope).envelopeId,envelope.id); assert.equal(envelope.flow.evaluatedAt,100);
});
test("optional confidential data is omitted when release was not approved", () => {
  const f=fixture(); f.add("optional-private","fact","OPTIONAL_PRIVATE",{}, { confidentiality:"confidential" }); f.request.optionalRefs.push("optional-private");
  const envelope=f.engine.build(f.request);
  assert.equal(envelope.exclusions[0]!.reason,"release_approval_required");
  assert.ok(!f.engine.render(envelope).content.includes("OPTIONAL_PRIVATE"));
});
