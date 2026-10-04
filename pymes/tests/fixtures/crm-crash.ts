import { openWorkspaceRuntime } from '../../src/runtime-source.js';
const runtime = await openWorkspaceRuntime(process.argv[2]!, 'agency');
runtime.source.crm!.command('agency', 'owner', { commandId: 'create-once', expectedRevision: 0, operation: { type: 'contact.create', id: 'client-1', name: 'Cliente sintético', email: 'cliente@example.test', phone: '', notes: '', relationship: 'prospect' } });
process.send?.('committed');
setInterval(() => { }, 1000);
