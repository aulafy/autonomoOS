import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CapsuleStore } from '../src/capsule-store.js';
const install = { commandId: 'install', expectedRevision: 0, capsuleId: 'crm.client-summary', version: '1.0.0',
  enabled: true, grants: ['database.query'], config: { title: 'Mi cartera', limit: 12, relationship: 'all' } };
for (const phase of ['before', 'after'] as const) test(`capsule SIGKILL ${phase} commit preserves an atomic decision and supports retry`, { timeout: 15000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'capsule-crash-')), path = join(dir, 'capsules.db');
  let store = new CapsuleStore(path, 'agency');
  try {
    store.apply('agency', 'owner', install); store.close();
    const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./fixtures/capsule-crash.ts', import.meta.url)), path, phase], { stdio: ['ignore', 'pipe', 'pipe'] });
    let error = ''; child.stderr.on('data', b => { error += String(b); });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 10000);
    const result = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
    }); clearTimeout(timer);
    assert.equal(timedOut, false, 'Child must reach the crash hook before the timeout');
    assert.equal(result.signal, 'SIGKILL', error);
    store = new CapsuleStore(path, 'agency');
    const recovered = store.catalog('agency', 'owner');
    assert.equal(recovered.revision, phase === 'before' ? 1 : 2);
    assert.equal(recovered.items[0]!.installation!.enabled, phase === 'before');
    assert.equal(recovered.audit.length, phase === 'before' ? 1 : 2);
    const disable = { ...install, commandId: 'disable', expectedRevision: 1, enabled: false };
    const receipt = store.apply('agency', 'owner', disable);
    assert.equal(receipt.revision, 2); assert.deepEqual(store.apply('agency', 'owner', disable), receipt);
    assert.equal(store.catalog('agency', 'owner').audit.length, 2);
  } finally { try { store.close(); } catch {} rmSync(dir, { recursive: true, force: true }); }
});
