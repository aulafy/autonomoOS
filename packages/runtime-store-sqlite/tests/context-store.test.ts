import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture } from "../../context-engine/tests/helpers.js";
import { RuntimeDatabase,JournalKernel,ReplayClock,createDurableContextStore } from "../src/index.js";
test("immutable context versions and provenance survive SQLite close and journal restore", async () => {
  const folder=mkdtempSync(join(tmpdir(),"aw2-context-")); let database=new RuntimeDatabase(join(folder,"runtime.db"));
  try {
    const journal=new JournalKernel(database,new ReplayClock(() => 100)),store=createDurableContextStore(journal); await journal.restore();
    const f=fixture(),first=f.engine.build(f.request); store.record(first);
    const second=f.engine.build({ ...f.request,version: 2,previousEnvelopeId:first.id }); store.record(second);
    database.close(); database=new RuntimeDatabase(join(folder,"runtime.db"));
    const next=new JournalKernel(database,new ReplayClock(() => 200)),restored=createDurableContextStore(next); await next.restore();
    assert.deepEqual(restored.get(first.id),first); assert.deepEqual(restored.get(second.id),second);
    assert.equal(f.engine.render(restored.get(second.id)!).format,"orca-spec");
    f.deny(); assert.throws(() => f.engine.render(restored.get(second.id)!));
  } finally { database.close(); rmSync(folder,{ recursive:true,force:true }); }
});
