import test from 'node:test';
import assert from 'node:assert/strict';
import { VerifierRegistry } from '../src/index.js';
import type { VerificationInput,CriterionResult } from '../src/types.js';
const input:VerificationInput={taskId:'t',workUnitId:'u',attemptId:'a',criterion:{id:'c',kind:'test',command:'test',expectedExitCode:0},maxAgeMs:100};
const success:CriterionResult={criterionId:'c',verifierId:'v',status:'satisfied',reason:'passed',observationRefs:['o'],observedAt:1};
test('already aborted verification invokes no verifier',async()=>{
 const registry=new VerifierRegistry();let calls=0;
 registry.register({id:'v',supports:()=>true,verify:async()=>{calls++;return success;}});
 const controller=new AbortController();controller.abort();
 assert.equal((await registry.verify(input,controller.signal)).reason,'verification_aborted');assert.equal(calls,0);
});
test('unresponsive verifier is bounded and receives cancellation',async()=>{
 const registry=new VerifierRegistry(20);let signal:AbortSignal|undefined;
 registry.register({id:'v',supports:()=>true,verify:async(_,s)=>{signal=s;return new Promise(()=>{});}});
 assert.equal((await registry.verify(input)).reason,'verification_timeout');assert.equal(signal?.aborted,true);
});
test('abort during execution cannot promote late success',async()=>{
 const registry=new VerifierRegistry();const controller=new AbortController();
 registry.register({id:'v',supports:()=>true,verify:async()=>{controller.abort();return success;}});
 assert.equal((await registry.verify(input,controller.signal)).status,'unknown');
});
test('duplicate evidence references and nontext reasons fail closed',async()=>{
 for(const malformed of [{...success,observationRefs:['o','o']},{...success,reason:42}]) {
 const registry=new VerifierRegistry();registry.register({id:'v',supports:()=>true,verify:async()=>malformed as CriterionResult});
 assert.equal((await registry.verify(input)).reason,'malformed_verifier_result');
 }
});
