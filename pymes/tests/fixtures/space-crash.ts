import { CapsuleStore } from '../../src/capsule-store.js';
const [path, phase] = process.argv.slice(2);
if (!path || !['before', 'after'].includes(phase!)) throw new Error('QA_ARGUMENTS');
const kill = () => { process.kill(process.pid, 'SIGKILL'); throw new Error('SIGKILL_DID_NOT_FIRE'); };
const store = new CapsuleStore(path, 'agency', undefined, Date.now, phase === 'before' ? { beforeCommit: kill } : { afterCommit: kill });
store.configureSpace('agency', 'owner', { commandId: 'reorder', expectedRevision: 1, name: 'Estudio QA', templateId: 'consulting', modules: ['crm', 'followups', 'gmail'] });
throw new Error('QA_CRASH_HOOK_NOT_REACHED');
