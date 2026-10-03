import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeDatabase,JournalKernel,ReplayClock,createDurableEvidenceLedger } from "../src/index.js";
import type { EvidenceRecord } from "@agent-world/evidence-ledger";
test("provider claim and contradictory independent evidence both survive journal restore",async () => {
  const folder=mkdtempSync(join(tmpdir(),"aw2-evidence-")); let database=new RuntimeDatabase(join(folder,"runtime.db"));
  try {
    const journal=new JournalKernel(database,new ReplayClock(() => 100)),ledger=createDurableEvidenceLedger(journal); await journal.restore();
    const claim:EvidenceRecord={ id:"claim",taskId:"task",workUnitId:"unit",attemptId:"attempt",claim:"Worker says tests pass",source:{ kind:"provider-report",providerId:"orca",providerMessageId:"message" },strength:"claim",observedBy:{ id:"host",kind:"host" },createdAt:100,provenance:[{ sourceRef:"message",operation:"observed",actor:{ id:"host",kind:"host" },createdAt:100 }] };
    ledger.append(claim); const independent:EvidenceRecord={ ...claim,id:"independent",claim:"Test observation reports failure",source:{ kind:"verifier",verifierId:"test",criterionId:"criterion",observationRefs:["observation"] },strength:"independently-verified",structuredPayload:{ status:"unsatisfied",exitCode:1 } }; ledger.append(independent);
    database.close(); database=new RuntimeDatabase(join(folder,"runtime.db")); const next=new JournalKernel(database,new ReplayClock(() => 200)),restored=createDurableEvidenceLedger(next); await next.restore();
    assert.deepEqual(restored.list("task"),[claim,independent]); assert.equal(restored.forCriterion("task","attempt","criterion")[0]!.strength,"independently-verified");
  } finally { database.close(); rmSync(folder,{recursive:true,force:true}); }
});
