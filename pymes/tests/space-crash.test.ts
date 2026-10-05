import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { CapsuleStore } from '../src/capsule-store.js';
import { defaultSpace, type SpaceCommand } from '../src/space-contract.js';
for (const phase of ['before','after'] as const) test(`space SIGKILL ${phase} commit preserves an atomic profile and one receipt`, { timeout: 15000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'space-crash-')), path = join(dir, 'capsules.db'); let store = new CapsuleStore(path, 'agency');
  try {
    store.configureSpace('agency', 'owner', { ...defaultSpace(), commandId: 'initial', expectedRevision: 0 }); store.close();
    const child = spawn(process.execPath, ['--import','tsx',fileURLToPath(new URL('./fixtures/space-crash.ts',import.meta.url)),path,phase], { stdio: ['ignore','ignore','pipe'] });
    let timedOut = false, error = ''; child.stderr.on('data', data => { error += String(data); });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); },10000);
    const result = await new Promise<string|null>((resolve,reject) => { child.once('error',reject); child.once('close',(_code,signal) => resolve(signal)); }); clearTimeout(timer);
    assert.equal(timedOut,false); assert.equal(result,'SIGKILL',error);
    store = new CapsuleStore(path,'agency'); const view = store.space('agency','owner');
    assert.equal(view.revision,phase === 'before' ? 1 : 2); assert.deepEqual(view.settings.modules,phase === 'before' ? ['gmail','crm','followups'] : ['crm','followups','gmail']);
    const input: SpaceCommand = { commandId: 'reorder', expectedRevision: 1, name: 'Estudio QA', templateId: 'consulting', modules: ['crm','followups','gmail'] };
    const receipt = store.configureSpace('agency','owner',input); assert.equal(receipt.revision,2); assert.deepEqual(store.configureSpace('agency','owner',input),receipt); assert.equal(store.space('agency','owner').history.length,2);
  } finally { try { store.close(); } catch {} rmSync(dir,{recursive:true,force:true}); }
});
