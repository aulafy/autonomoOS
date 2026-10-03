import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../../control-plane/tests/helpers.js";
import { recordDigest } from "@agent-world/decision-ledger";
import { GovernedVerificationCollector,VerificationCollectionStore,DeterministicVerifier,type VerificationInput } from "../src/index.js";
const input:VerificationInput={taskId:"task-1",workUnitId:"unit",attemptId:"attempt",criterion:{id:"position",kind:"observation",predicate:{path:["confirmed"],equals:true}},maxAgeMs:100};
async function setup() {
  const f=await fixture(),store=new VerificationCollectionStore();
  const collector=new GovernedVerificationCollector({ runner:f.runner,observations:f.observations,observers:f.observers,store,observerIds:["world-observer"],
    plan:async (value,key) => ({...structuredClone(f.request),correlationId:key,intent:{...structuredClone(f.request.intent),parameters:{verificationCriterionDigest:recordDigest(value.criterion)}}}),
    decode:observation => ({confirmed:observation.status==="confirmed"}) });
  return {f,store,collector};
}
test("production collector traverses the real C12 runner and caches the observed result",async () => {
  const {f,collector}=await setup(); const result=await collector.collect(input,new AbortController().signal);
  assert.equal(result.status,"observed"); assert.equal(f.executorCalls(),1);
  assert.ok(f.events.events.some(event => event.type==="action.commit_allowed"));
  assert.deepEqual(await collector.collect(input,new AbortController().signal),result); assert.equal(f.executorCalls(),1);
});
test("contradicted C5 observation becomes unsatisfied rather than provider success",async () => {
  const {f,collector}=await setup(); f.setObservationStatus("contradicted");
  const result=await new DeterministicVerifier("observation",collector,() => 100).verify(input);
  assert.equal(result.status,"unsatisfied"); assert.equal(f.executorCalls(),1);
});
test("lease revocation prevents collection execution and does not authorize another try",async () => {
  const {f,collector}=await setup(); f.grant.revokedAt=100;
  assert.equal((await collector.collect(input,new AbortController().signal)).status,"unknown");
  f.grant.revokedAt=undefined;
  assert.equal((await collector.collect(input,new AbortController().signal)).status,"unknown"); assert.equal(f.executorCalls(),0);
});
test("observer failure remains unknown and never dispatches twice",async () => {
  const {f,collector}=await setup(); f.setObserverThrows(true);
  assert.equal((await collector.collect(input,new AbortController().signal)).status,"unknown");
  assert.equal((await collector.collect(input,new AbortController().signal)).status,"unknown"); assert.equal(f.executorCalls(),1);
});
test("an existing unfinished claim requires reconciliation rather than dispatch",async () => {
  const {f,collector,store}=await setup(); const {verificationCollectionKey}=await import("../src/index.js"); store.claim(verificationCollectionKey(input));
  assert.deepEqual(await collector.collect(input,new AbortController().signal),{status:"unknown",reason:"collection_reconciliation_required"}); assert.equal(f.executorCalls(),0);
});
test("expired cached observations cannot cause a fresh automatic action",async () => {
  const {f,collector}=await setup(); await collector.collect(input,new AbortController().signal);
  assert.equal((await new DeterministicVerifier("observation",collector,() => 300).verify(input)).status,"unknown"); assert.equal(f.executorCalls(),1);
});
