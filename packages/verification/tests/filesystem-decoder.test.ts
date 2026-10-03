import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {InMemoryResourceRegistry} from '@agent-world/resources';
import {FilesystemWorkspace,FilesystemObserver} from '@agent-world/filesystem';
import {decodeFilesystemVerification,DeterministicVerifier} from '../src/index.js';
import {recordDigest} from '@agent-world/decision-ledger';
import type {VerificationInput} from '../src/types.js';
test('real filesystem observer supplies digest and existence verification without file content disclosure',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'aw2-file-check-'));
 try {
  const resources=new InMemoryResourceRegistry(),workspace=new FilesystemWorkspace(directory,resources);
  writeFileSync(join(directory,'proposal.txt'),'Checked draft');
  const file=workspace.registerFile({relativePath:'proposal.txt'}),observer=new FilesystemObserver(workspace,resources,()=>100);
  const input:VerificationInput={taskId:'task',workUnitId:'unit',attemptId:'attempt',criterion:{id:'file-check',kind:'file',resource:file.id,assertion:{digest:`sha256:${createHash('sha256').update('Checked draft').digest('hex')}`}},maxAgeMs:100};
  const request={subject:{taskId:'task',intentId:'intent',effectId:'effect',resourceIds:[file.id]},expectedPostcondition:{kind:'filesystem_read',resourceIds:[file.id],predicate:'exists' as const,expected:null,metadata:{}},context:{resourceIds:[file.id]}};
  const observation=await observer.observe(request,new AbortController().signal);
  const payload=decodeFilesystemVerification(observation,input);
  assert.equal(JSON.stringify(payload).includes('Checked draft'),false);
  const verifier=new DeterministicVerifier('file',{collect:async()=>({status:'observed',taskId:'task',workUnitId:'unit',attemptId:'attempt',criterionDigest:recordDigest(input.criterion),observationRefs:[observation.id],observedAt:100,payload})},()=>100);
  assert.equal((await verifier.verify(input)).status,'satisfied');
  writeFileSync(join(directory,'proposal.txt'),'Changed draft');
  const changed=await observer.observe(request,new AbortController().signal);
  const changedPayload=decodeFilesystemVerification(changed,input);
  const failure=new DeterministicVerifier('file',{collect:async()=>({status:'observed',taskId:'task',workUnitId:'unit',attemptId:'attempt',criterionDigest:recordDigest(input.criterion),observationRefs:[changed.id],observedAt:100,payload:changedPayload})},()=>100);
  assert.equal((await failure.verify(input)).status,'unsatisfied');
  assert.throws(()=>decodeFilesystemVerification({...observation,subject:{...observation.subject,taskId:'other'}},input),/UNBOUND/);
  assert.throws(()=>decodeFilesystemVerification({...observation,evidence:[...observation.evidence,...observation.evidence]},input),/AMBIGUOUS/);
  assert.throws(()=>decodeFilesystemVerification({...observation,expectedPostconditionHash:'changed'},input),/UNBOUND/);
  rmSync(join(directory,'proposal.txt'));
  const missing=await observer.observe(request,new AbortController().signal);
  assert.deepEqual(decodeFilesystemVerification(missing,input),{resource:file.id,exists:false});
 } finally {rmSync(directory,{recursive:true,force:true});}
});
