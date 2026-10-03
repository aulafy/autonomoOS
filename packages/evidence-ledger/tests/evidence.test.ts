import test from "node:test";
import assert from "node:assert/strict";
import { EvidenceLedger,type EvidenceRecord } from "../src/index.js";
const claim=():EvidenceRecord => ({ id:"claim",taskId:"task",workUnitId:"unit",attemptId:"attempt",claim:"Worker reports completion",source:{ kind:"provider-report",providerId:"orca",providerMessageId:"message" },strength:"claim",observedBy:{ id:"host",kind:"host" },createdAt:100,provenance:[{ sourceRef:"message",operation:"observed",actor:{ id:"host",kind:"host" },createdAt:100 }] });
test("provider done remains a claim and cannot be promoted by changing strength",() => {
  const ledger=new EvidenceLedger(); ledger.append(claim());
  for (const strength of ["observed","independently-verified"] as const) assert.throws(() => ledger.append({ ...claim(),id:strength,strength }),/PROVIDER_REPORT_IS_NOT_VERIFIED/);
  assert.equal(ledger.list("task").length,1);
});
test("evidence identity is immutable, exact duplicate is idempotent and reads are detached",() => {
  const ledger=new EvidenceLedger(),record=claim(),receipt=ledger.append(record); assert.deepEqual(ledger.append(record),receipt);
  record.claim="changed"; assert.throws(() => ledger.append(record),/ID_CONFLICT/);
  const copy=ledger.get("claim")!; copy.claim="mutated"; assert.equal(ledger.get("claim")!.claim,"Worker reports completion");
});
test("observations and human approvals require a verifier before independent promotion",() => {
  const ledger=new EvidenceLedger();
  for (const source of [{ kind:"observation",observationId:"observation" } as const,{ kind:"human",approvalId:"approval",principalId:"owner" } as const]) {
    assert.throws(() => ledger.append({ ...claim(),source,strength:"independently-verified" }));
  }
});
test("independent evidence is scoped to an exact attempt and criterion with observation references",() => {
  const ledger=new EvidenceLedger(),record:EvidenceRecord={ ...claim(),id:"verification",claim:"Independent test failed",source:{ kind:"verifier",verifierId:"test",criterionId:"criterion",observationRefs:["observation"] },strength:"independently-verified",structuredPayload:{ status:"unsatisfied",exitCode:1 } };
  ledger.append(record); ledger.append(claim()); assert.equal(ledger.list("task").length,2);
  assert.deepEqual(ledger.forCriterion("task","attempt","criterion"),[record]);
  assert.equal(ledger.forCriterion("task","another-attempt","criterion").length,0);
  assert.throws(() => ledger.append({ ...record,id:"bad",source:{ ...record.source as Extract<EvidenceRecord["source"],{kind:"verifier"}>,observationRefs:[] } }));
});
