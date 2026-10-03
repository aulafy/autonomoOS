import test from "node:test";
import assert from "node:assert/strict";
import { DecisionLedger,type DecisionRecord } from "../src/index.js";
export function decision(id="d1"): DecisionRecord { return { id,taskId:"task",question:"Which database?",choice:"SQLite",madeBy:{ id:"architecture",kind:"actor",providerId:"local" },authority:{ principalId:"owner",role:"architecture",authorizationRef:"permit:architecture" },evidenceRefs:["benchmark"],createdAt:100,provenance:[{ sourceRef:"planning:1",operation:"created",actor:{ id:"host",kind:"host" },createdAt:100 }] }; }
test("decisions are append-only, detached and idempotent",() => {
  const ledger=new DecisionLedger(),d=decision(),receipt=ledger.append(d); assert.deepEqual(ledger.append(d),receipt);
  assert.throws(() => ledger.append({ ...d,choice:"PostgreSQL" }),/ID_CONFLICT/);
  d.choice="mutated"; const copy=ledger.get("d1")!; copy.choice="also mutated"; assert.equal(ledger.get("d1")!.choice,"SQLite");
});
test("superseded decisions remain auditable and aliases resolve the current leaf",() => {
  const ledger=new DecisionLedger(); ledger.append(decision());
  ledger.append({ ...decision("d2"),choice:"PostgreSQL",supersedes:"d1",createdAt:101 });
  ledger.append({ ...decision("d3"),choice:"SQLite with WAL",supersedes:"d2",createdAt:102 });
  assert.equal(ledger.get("d1")!.choice,"SQLite"); assert.equal(ledger.resolveCurrent("d1")!.id,"d3");
  assert.deepEqual(ledger.current("task").map(value => value.id),["d3"]); assert.equal(ledger.history("task").length,3);
});
test("branching, foreign scope, question changes and time regression are rejected atomically",() => {
  const ledger=new DecisionLedger(); ledger.append(decision()); ledger.append({ ...decision("d2"),supersedes:"d1",createdAt:101 });
  assert.throws(() => ledger.append({ ...decision("branch"),supersedes:"d1",createdAt:102 }),/ALREADY_SUPERSEDED/);
  for (const patch of [{ taskId:"foreign" },{ workUnitId:"foreign-unit" },{ question:"Different question" },{ createdAt:99 }]) assert.throws(() => ledger.append({ ...decision("bad"),supersedes:"d2",...patch }));
  assert.deepEqual(ledger.history("task").map(value => value.id),["d1","d2"]);
});
test("record schemas reject unknown metadata and malformed provenance",() => {
  const ledger=new DecisionLedger(); assert.throws(() => ledger.append({ ...decision(),password:"secret" } as DecisionRecord));
  assert.throws(() => ledger.append({ ...decision(),provenance:[] }));
  assert.throws(() => ledger.append({ ...decision(),provenance:[{ ...decision().provenance[0]!,createdAt:200 }] }));
});
