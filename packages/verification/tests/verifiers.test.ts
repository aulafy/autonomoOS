import test from "node:test";
import assert from "node:assert/strict";
import type { JsonValue,SuccessCriterion } from "@agent-world/task-runtime";
import { recordDigest } from "@agent-world/decision-ledger";
import { DeterministicVerifier,VerifierRegistry,type VerificationInput,type VerificationCollector } from "../src/index.js";
function input(criterion:SuccessCriterion):VerificationInput { return {taskId:"task",workUnitId:"unit",attemptId:"attempt",criterion,maxAgeMs:100}; }
function collector(payload:JsonValue):VerificationCollector { return { collect:async value => ({status:"observed",taskId:value.taskId,workUnitId:value.workUnitId,attemptId:value.attemptId,criterionDigest:recordDigest(value.criterion),observationRefs:["observation"],observedAt:100,payload}) }; }
test("test verifier binds the exact command and reports independent failure",async () => {
  const criterion:SuccessCriterion={id:"test",kind:"test",command:"npm test",expectedExitCode:0};
  assert.equal((await new DeterministicVerifier("test",collector({command:"npm test",exitCode:1}),() => 100).verify(input(criterion))).status,"unsatisfied");
  assert.equal((await new DeterministicVerifier("test",collector({command:"npm test",exitCode:0}),() => 100).verify(input(criterion))).status,"satisfied");
  assert.equal((await new DeterministicVerifier("test",collector({command:"different",exitCode:0}),() => 100).verify(input(criterion))).status,"unknown");
});
test("file verifier checks existence, content and digest without reading ungoverned paths",async () => {
  const digest=`sha256:${"a".repeat(64)}`,criterion:SuccessCriterion={id:"file",kind:"file",resource:"file:report",assertion:{exists:true,contains:"ready",digest}};
  assert.equal((await new DeterministicVerifier("file",collector({resource:"file:report",exists:true,content:"ready",digest}),() => 100).verify(input(criterion))).status,"satisfied");
  assert.equal((await new DeterministicVerifier("file",collector({resource:"file:report",exists:false}),() => 100).verify(input(criterion))).status,"unsatisfied");
  assert.equal((await new DeterministicVerifier("file",collector({resource:"file:report",exists:true}),() => 100).verify(input(criterion))).status,"unknown");
});
test("schema verifier uses bounded isolated Ajv validation and rejects unsupported schemas",async () => {
  const criterion:SuccessCriterion={id:"schema",kind:"schema",artifactRef:"artifact",schema:{type:"object",properties:{count:{type:"integer"}},required:["count"],additionalProperties:false}};
  assert.equal((await new DeterministicVerifier("schema",collector({artifactRef:"artifact",value:{count:1}}),() => 100).verify(input(criterion))).status,"satisfied");
  assert.equal((await new DeterministicVerifier("schema",collector({artifactRef:"artifact",value:{count:"1"}}),() => 100).verify(input(criterion))).status,"unsatisfied");
  assert.equal((await new DeterministicVerifier("schema",collector({artifactRef:"artifact",value:{count:1}}),() => 100).verify(input({...criterion,schema:{$ref:"https://example.invalid/schema"}}))).status,"unknown");
});
test("HTTP verifier binds method/resource and checks status and body",async () => {
  const criterion:SuccessCriterion={id:"http",kind:"http",request:{method:"GET",urlResource:"service:health"},expectedStatus:200,bodyAssertion:{contains:"healthy"}};
  assert.equal((await new DeterministicVerifier("http",collector({method:"GET",urlResource:"service:health",status:200,body:"healthy"}),() => 100).verify(input(criterion))).status,"satisfied");
  assert.equal((await new DeterministicVerifier("http",collector({method:"GET",urlResource:"service:health",status:503,body:"unavailable"}),() => 100).verify(input(criterion))).status,"unsatisfied");
});
test("observation predicate checks own properties and fails closed on unsupported rules",async () => {
  const criterion:SuccessCriterion={id:"observation",kind:"observation",predicate:{path:["value","ready"],equals:true}};
  assert.equal((await new DeterministicVerifier("observation",collector({value:{ready:true}}),() => 100).verify(input(criterion))).status,"satisfied");
  assert.equal((await new DeterministicVerifier("observation",collector({value:{ready:false}}),() => 100).verify(input(criterion))).status,"unsatisfied");
  assert.equal((await new DeterministicVerifier("observation",collector({}),() => 100).verify(input({...criterion,predicate:{path:["__proto__"],equals:true}}))).status,"unknown");
});
test("human approval binds principal, attempt and validity window",async () => {
  const criterion:SuccessCriterion={id:"approval",kind:"human-approval",approver:"owner"},payload={principalId:"owner",taskId:"task",workUnitId:"unit",attemptId:"attempt",approvalId:"approval",approved:true,expiresAt:150};
  assert.equal((await new DeterministicVerifier("human-approval",collector(payload),() => 100).verify(input(criterion))).status,"satisfied");
  assert.equal((await new DeterministicVerifier("human-approval",collector({...payload,attemptId:"old"}),() => 100).verify(input(criterion))).status,"unknown");
  assert.equal((await new DeterministicVerifier("human-approval",collector(payload),() => 150).verify(input(criterion))).status,"unknown");
});
test("stale observations and collection uncertainty cannot satisfy a criterion",async () => {
  const criterion:SuccessCriterion={id:"test",kind:"test",command:"npm test",expectedExitCode:0};
  assert.equal((await new DeterministicVerifier("test",collector({command:"npm test",exitCode:0}),() => 300).verify(input(criterion))).status,"unknown");
  assert.equal((await new DeterministicVerifier("test",{collect:async () => ({status:"unknown",reason:"timeout"})},() => 100).verify(input(criterion))).status,"unknown");
});
test("registry rejects ambiguous or malformed verifier results",async () => {
  const registry=new VerifierRegistry(),criterion:SuccessCriterion={id:"test",kind:"test",command:"npm test",expectedExitCode:0};
  assert.equal((await registry.verify(input(criterion))).status,"unknown");
  registry.register(new DeterministicVerifier("test",collector({command:"npm test",exitCode:0}),() => 100));
  assert.equal((await registry.verify(input(criterion))).status,"satisfied");
  registry.register({id:"duplicate-kind",supports:() => true,verify:async () => {throw new Error("must not run");}});
  assert.equal((await registry.verify(input(criterion))).reason,"ambiguous_verifier");
});
