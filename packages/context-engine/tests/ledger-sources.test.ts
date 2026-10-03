import test from "node:test";
import assert from "node:assert/strict";
import { DecisionLedger,type DecisionRecord } from "@agent-world/decision-ledger";
import { ArtifactRegistry } from "@agent-world/artifacts";
import { ledgerContextSources } from "../src/index.js";
import { fixture } from "./helpers.js";
const base: DecisionRecord={ id:"d1",taskId:"task",question:"Which database?",choice:"SQLite",madeBy:{ id:"host",kind:"host" },authority:{ principalId:"owner",role:"architecture",authorizationRef:"permit" },evidenceRefs:[],createdAt:100,provenance:[{ sourceRef:"goal",operation:"created",actor:{ id:"host",kind:"host" },createdAt:100 }] };
test("downstream context receives the current decision while its predecessor remains auditable",() => {
  const decisions=new DecisionLedger(),artifacts=new ArtifactRegistry(); decisions.append(base); decisions.append({ ...base,id:"d2",choice:"PostgreSQL",supersedes:"d1",createdAt:101 });
  artifacts.append({ id:"output",taskId:"task",kind:"report",uri:"resource:file:report",digest:`sha256:${"a".repeat(64)}`,createdBy:base.madeBy,createdAt:101,provenance:base.provenance });
  const f=fixture(); f.add("decision-data","decision",null); f.add("artifact-data","artifact",null);
  const sources=ledgerContextSources({ taskId:"task",targetWorkUnitId:"unit",decisions,artifacts,decisionRefs:["d1"],artifactRefs:["output"],bind:(kind,id,digest) => {
    assert.match(digest,/^sha256:[a-f0-9]{64}$/); if (kind==="decision") assert.equal(id,"d2");
    return { objectId:kind==="decision" ? "object:decision-data" : "object:artifact-data",locality:"any" };
  } });
  f.catalog.push(...sources); f.request.requiredRefs=["decision:d1","artifact:output"];
  const envelope=f.engine.build(f.request),rendered=f.engine.render(envelope);
  assert.equal((envelope.decisions[0]!.value as { id:string }).id,"d2");
  assert.ok(rendered.content.includes("PostgreSQL")); assert.ok(!rendered.content.includes("SQLite"));
  assert.equal(decisions.get("d1")!.choice,"SQLite"); assert.equal(envelope.artifacts[0]!.id,"artifact:output");
});
test("ledger handoff rejects records from another task",() => {
  const decisions=new DecisionLedger(); decisions.append(base);
  assert.throws(() => ledgerContextSources({ taskId:"foreign",targetWorkUnitId:"unit",decisions,artifacts:new ArtifactRegistry(),decisionRefs:["d1"],artifactRefs:[],bind:() => ({ objectId:"object",locality:"any" }) }),/SCOPE_MISMATCH/);
});
