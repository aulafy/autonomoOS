import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,readFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
test("decision supersession and artifact provenance/digest survive SIGKILL and fresh-process restore",() => {
  const folder=mkdtempSync(join(tmpdir(),"aw2-records-")),driver=fileURLToPath(new URL("./fixtures/records-crash.ts",import.meta.url));
  try {
    const database=join(folder,"runtime.db"),before=join(folder,"before.json"),after=join(folder,"after.json");
    const killed=spawnSync(process.execPath,["--import","tsx",driver,"write",database,before],{ encoding:"utf8",timeout:10000 }); assert.equal(killed.signal,"SIGKILL",killed.stderr);
    const restored=spawnSync(process.execPath,["--import","tsx",driver,"read",database,after],{ encoding:"utf8",timeout:10000 }); assert.equal(restored.status,0,restored.stderr);
    const snapshot=JSON.parse(readFileSync(after,"utf8")); assert.deepEqual(snapshot,JSON.parse(readFileSync(before,"utf8")));
    assert.equal(snapshot.decisions[0].choice,"SQLite"); assert.equal(snapshot.current.id,"d2"); assert.equal(snapshot.artifacts[0].digest,`sha256:${"a".repeat(64)}`); assert.equal(snapshot.artifacts[0].provenance[0].sourceRef,"source");
  } finally { rmSync(folder,{ recursive:true,force:true }); }
});
