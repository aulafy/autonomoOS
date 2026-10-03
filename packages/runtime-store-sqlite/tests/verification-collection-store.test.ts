import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verificationCollectionKey,type VerificationInput } from "@agent-world/verification";
import { RuntimeDatabase,JournalKernel,ReplayClock,createDurableVerificationCollectionStore } from "../src/index.js";
test("unfinished verification collection claim and effect identity survive SQLite reopen",async () => {
  const folder=mkdtempSync(join(tmpdir(),"aw2-verification-")); let database=new RuntimeDatabase(join(folder,"runtime.db"));
  try {
    const journal=new JournalKernel(database,new ReplayClock(() => 100)),store=createDurableVerificationCollectionStore(journal); await journal.restore();
    const input:VerificationInput={taskId:"task",workUnitId:"unit",attemptId:"attempt",criterion:{id:"test",kind:"test",command:"npm test",expectedExitCode:0},maxAgeMs:100};
    const key=verificationCollectionKey(input); assert.equal(store.claim(key),true); store.prepared(key,"effect","intent"); database.close();
    database=new RuntimeDatabase(join(folder,"runtime.db")); const next=new JournalKernel(database,new ReplayClock(() => 200)),restored=createDurableVerificationCollectionStore(next); await next.restore();
    assert.equal(restored.claim(key),false); assert.deepEqual(restored.get(key)!.prepared,{effectId:"effect",intentId:"intent"}); assert.equal(restored.get(key)!.result,undefined);
  } finally { database.close(); rmSync(folder,{recursive:true,force:true}); }
});
