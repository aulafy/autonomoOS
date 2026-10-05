import { CapsuleStore } from '../../src/capsule-store.js';
const [path, phase] = process.argv.slice(2);
if (!path || !['before', 'after'].includes(phase!)) throw new Error('QA_ARGUMENTS_INVALID');
const kill = () => process.kill(process.pid, 'SIGKILL');
const store = new CapsuleStore(path, 'agency', undefined, () => 2000,
  phase === 'before' ? { beforeCommit: kill } : { afterCommit: kill });
store.apply('agency', 'owner', { commandId: 'disable', expectedRevision: 1, capsuleId: 'crm.client-summary', version: '1.0.0',
  enabled: false, grants: ['database.query'], config: { title: 'Mi cartera', limit: 12, relationship: 'all' } });
throw new Error('QA_CRASH_HOOK_NOT_REACHED');
