import { writeFileSync } from "node:fs";
import { RuntimeDatabase,JournalKernel,ReplayClock,createDurableRecordStores } from "../../src/index.js";
import type { DecisionRecord } from "@agent-world/decision-ledger";
const [phase,path,output]=process.argv.slice(2); if (!path || !output) throw new Error("ARGUMENTS_REQUIRED");
const database=new RuntimeDatabase(path),journal=new JournalKernel(database,new ReplayClock(() => 100)),stores=createDurableRecordStores(journal); await journal.restore();
if (phase==="write") {
  const d: DecisionRecord={ id:"d1",taskId:"task",question:"Which database?",choice:"SQLite",madeBy:{ id:"host",kind:"host" },authority:{ principalId:"owner",role:"architecture",authorizationRef:"permit" },evidenceRefs:["evidence"],createdAt:100,provenance:[{ sourceRef:"source",operation:"created",actor:{ id:"host",kind:"host" },createdAt:100 }] };
  stores.decisions.append(d); stores.decisions.append({ ...d,id:"d2",choice:"PostgreSQL",supersedes:"d1",createdAt:101 });
  stores.artifacts.append({ id:"artifact",taskId:"task",kind:"report",uri:"resource:file:report",digest:`sha256:${"a".repeat(64)}`,mediaType:"application/json",createdBy:d.madeBy,createdAt:101,provenance:d.provenance });
}
writeFileSync(output,JSON.stringify({ decisions:stores.decisions.history("task"),current:stores.decisions.resolveCurrent("d1"),artifacts:stores.artifacts.list("task") }));
if (phase==="write") process.kill(process.pid,"SIGKILL"); else database.close();
